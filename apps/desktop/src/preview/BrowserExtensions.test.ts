// @effect-diagnostics nodeBuiltinImport:off - Effect's FileSystem cannot create a FIFO; mkfifo does.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { BROWSER_EXTENSION_MAX_COUNT } from "@t3tools/contracts";
import type { Session } from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({ BrowserWindow: {}, session: {} }));

import * as BrowserExtensionManifest from "./BrowserExtensionManifest.ts";
import * as BrowserExtensions from "./BrowserExtensions.ts";
import * as BrowserSession from "./BrowserSession.ts";

const manifest = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ manifest_version: 3, name: "Example", version: "1.2.3", ...fields });

describe("browser extension entries", () => {
  it("drops blank and duplicate paths and caps the list", () => {
    const many = Array.from({ length: BROWSER_EXTENSION_MAX_COUNT + 5 }, (_, index) => ({
      path: `/ext/${index}`,
    }));
    assert.deepStrictEqual(
      BrowserExtensions.normalizeExtensionEntries([
        { path: " /ext/a " },
        { path: "/ext/a", enabled: false },
        { path: "   " },
        { path: "/ext/b", enabled: false },
      ]),
      [
        { path: "/ext/a", enabled: true },
        { path: "/ext/b", enabled: false },
      ],
    );
    assert.strictEqual(
      BrowserExtensions.normalizeExtensionEntries(many).length,
      BROWSER_EXTENSION_MAX_COUNT,
    );
  });

  it("reads a corrupt store as empty instead of failing startup", () => {
    assert.deepStrictEqual(BrowserExtensions.decodeExtensionEntries("{not json"), []);
    assert.deepStrictEqual(BrowserExtensions.decodeExtensionEntries('{"extensions":7}'), []);
    assert.deepStrictEqual(
      BrowserExtensions.decodeExtensionEntries('{"extensions":[{"path":"/ext/a"}]}'),
      [{ path: "/ext/a", enabled: true }],
    );
  });

  it("refuses duplicates and additions past the limit", () => {
    const entries = [{ path: "/ext/a", enabled: true }];
    assert.deepStrictEqual(BrowserExtensions.addExtensionEntry(entries, "/ext/a"), {
      refusal: "alreadyAdded",
    });
    const full = Array.from({ length: BROWSER_EXTENSION_MAX_COUNT }, (_, index) => ({
      path: `/ext/${index}`,
      enabled: true,
    }));
    assert.deepStrictEqual(BrowserExtensions.addExtensionEntry(full, "/ext/new"), {
      refusal: "limitReached",
    });
    assert.deepStrictEqual(BrowserExtensions.addExtensionEntry(entries, "/ext/b"), {
      entries: [...entries, { path: "/ext/b", enabled: true }],
    });
  });

  it("toggles and removes only the named path", () => {
    const entries = [
      { path: "/ext/a", enabled: true },
      { path: "/ext/b", enabled: true },
    ];
    assert.deepStrictEqual(BrowserExtensions.setExtensionEntryEnabled(entries, "/ext/b", false), [
      { path: "/ext/a", enabled: true },
      { path: "/ext/b", enabled: false },
    ]);
    assert.deepStrictEqual(BrowserExtensions.removeExtensionEntry(entries, "/ext/a"), [
      { path: "/ext/b", enabled: true },
    ]);
  });
});

describe("parseExtensionManifest", () => {
  it("accepts MV2 and MV3 manifests, including a UTF-8 BOM", () => {
    assert.deepStrictEqual(
      BrowserExtensionManifest.parseExtensionManifest(`﻿${manifest({ default_locale: "en" })}`),
      { name: "Example", version: "1.2.3", manifestVersion: 3, defaultLocale: "en" },
    );
    assert.strictEqual(
      BrowserExtensionManifest.parseExtensionManifest(manifest({ manifest_version: 2 }))
        ?.manifestVersion,
      2,
    );
  });

  it("rejects text Chromium would not load", () => {
    assert.isNull(BrowserExtensionManifest.parseExtensionManifest("nope"));
    assert.isNull(BrowserExtensionManifest.parseExtensionManifest("[]"));
    assert.isNull(
      BrowserExtensionManifest.parseExtensionManifest(manifest({ manifest_version: 1 })),
    );
    assert.isNull(BrowserExtensionManifest.parseExtensionManifest(manifest({ version: "" })));
  });

  it("resolves localized names case-insensitively", () => {
    assert.strictEqual(BrowserExtensionManifest.localizedMessageKey("__MSG_appName__"), "appName");
    assert.isNull(BrowserExtensionManifest.localizedMessageKey("Plain"));
    assert.strictEqual(
      BrowserExtensionManifest.resolveLocalizedMessage(
        "appName",
        JSON.stringify({ APPNAME: { message: "Localized" } }),
      ),
      "Localized",
    );
    assert.isNull(BrowserExtensionManifest.resolveLocalizedMessage("missing", "{}"));
  });
});

interface FakeSession {
  readonly session: Session;
  readonly loadExtension: ReturnType<typeof vi.fn>;
  readonly removeExtension: ReturnType<typeof vi.fn>;
  readonly getAllExtensions: ReturnType<typeof vi.fn>;
}

const makeFakeSession = (failingPaths: ReadonlySet<string> = new Set()): FakeSession => {
  const loadExtension = vi.fn(async (path: string) => {
    if (failingPaths.has(path)) throw new Error("Manifest file is missing or unreadable");
    return { id: `id:${path}` };
  });
  const removeExtension = vi.fn();
  const getAllExtensions = vi.fn((): Array<{ id: string; path: string }> => []);
  return {
    session: {
      extensions: { loadExtension, removeExtension, getAllExtensions },
    } as unknown as Session,
    loadExtension,
    removeExtension,
    getAllExtensions,
  };
};

const makeFakeBrowserSessions = () => {
  const initializers: Array<(browserSession: Session) => Effect.Effect<void>> = [];
  const sessions: Array<Session> = [];
  const hooks = { onSessionsRead: () => {} };
  const service = BrowserSession.BrowserSession.of({
    getPartition: () => Effect.die("unused"),
    isPartition: () => true,
    getSession: () => Effect.die("unused"),
    clearCookies: () => Effect.die("unused"),
    clearCache: () => Effect.die("unused"),
    addPersistentSessionInitializer: (initialize) =>
      Effect.sync(() => {
        initializers.push(initialize);
      }),
    persistentSessions: Effect.sync(() => {
      hooks.onSessionsRead();
      return [...sessions];
    }),
  });
  // Like the real service, a session is listed before its initializers run.
  const create = Effect.fnUntraced(function* (fake: FakeSession) {
    sessions.push(fake.session);
    for (const initialize of initializers) yield* initialize(fake.session);
    return fake;
  });
  return { service, create, hooks };
};

const setup = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-browser-ext-" });
  const extensionPath = path.join(root, "extension");
  yield* fileSystem.makeDirectory(extensionPath);
  yield* fileSystem.writeFileString(path.join(extensionPath, "manifest.json"), manifest());
  const storePath = path.join(root, "state", BrowserExtensions.BROWSER_EXTENSIONS_FILE_NAME);
  const browserSessions = makeFakeBrowserSessions();
  const make = BrowserExtensions.makeAt(storePath).pipe(
    Effect.provideService(BrowserSession.BrowserSession, browserSessions.service),
  );
  return { fileSystem, path, root, extensionPath, storePath, browserSessions, make };
});

describe("BrowserExtensions", () => {
  it.effect("persists an added extension and loads it into current and later sessions", () =>
    Effect.gen(function* () {
      const { fileSystem, extensionPath, storePath, browserSessions, make } = yield* setup();
      const existing = yield* browserSessions.create(makeFakeSession());
      const extensions = yield* make;

      const added = yield* extensions.add(extensionPath);
      assert.isNull(added.refusal);
      assert.deepStrictEqual(added.extensions, [
        {
          path: extensionPath,
          enabled: true,
          name: "Example",
          version: "1.2.3",
          manifestVersion: 3,
          problem: null,
          detail: null,
        },
      ]);
      assert.deepStrictEqual(existing.loadExtension.mock.calls, [
        [extensionPath, { allowFileAccess: false }],
      ]);

      const later = yield* browserSessions.create(makeFakeSession());
      assert.strictEqual(later.loadExtension.mock.calls.length, 1);

      const stored = yield* fileSystem.readFileString(storePath);
      assert.deepStrictEqual(BrowserExtensions.decodeExtensionEntries(stored), [
        { path: extensionPath, enabled: true },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("unloads on disable and remove, and reloads on enable", () =>
    Effect.gen(function* () {
      const { extensionPath, storePath, browserSessions, make } = yield* setup();
      const fake = yield* browserSessions.create(makeFakeSession());
      const extensions = yield* make;
      yield* extensions.add(extensionPath);

      const disabled = yield* extensions.setEnabled(extensionPath, false);
      assert.isFalse(disabled.extensions[0]?.enabled);
      assert.deepStrictEqual(fake.removeExtension.mock.calls, [[`id:${extensionPath}`]]);

      yield* extensions.setEnabled(extensionPath, true);
      assert.strictEqual(fake.loadExtension.mock.calls.length, 2);

      const removed = yield* extensions.remove(extensionPath);
      assert.deepStrictEqual(removed.extensions, []);
      assert.strictEqual(fake.removeExtension.mock.calls.length, 2);

      // A fresh service over the same store sees the removal.
      const restarted = yield* BrowserExtensions.makeAt(storePath).pipe(
        Effect.provideService(BrowserSession.BrowserSession, makeFakeBrowserSessions().service),
      );
      assert.deepStrictEqual(yield* restarted.list, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a folder without a manifest and keeps the list unchanged", () =>
    Effect.gen(function* () {
      const { fileSystem, root, storePath, make } = yield* setup();
      const extensions = yield* make;

      const refused = yield* extensions.add(root);
      assert.strictEqual(refused.refusal, "missingManifest");
      assert.deepStrictEqual(refused.extensions, []);
      assert.isFalse(yield* fileSystem.exists(storePath));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports Electron load failures on the extension until a retry succeeds", () =>
    Effect.gen(function* () {
      const { extensionPath, browserSessions, make } = yield* setup();
      yield* browserSessions.create(makeFakeSession(new Set([extensionPath])));
      const extensions = yield* make;

      const added = yield* extensions.add(extensionPath);
      assert.strictEqual(added.extensions[0]?.problem, "loadFailed");
      assert.strictEqual(added.extensions[0]?.detail, "Manifest file is missing or unreadable");

      const disabled = yield* extensions.setEnabled(extensionPath, false);
      assert.isNull(disabled.extensions[0]?.problem);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("flags an extension whose folder lost its manifest", () =>
    Effect.gen(function* () {
      const { fileSystem, path, extensionPath, make } = yield* setup();
      const extensions = yield* make;
      yield* extensions.add(extensionPath);
      yield* fileSystem.remove(path.join(extensionPath, "manifest.json"));

      const [status] = yield* extensions.list;
      assert.strictEqual(status?.problem, "missingManifest");
      assert.isNull(status?.name);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not load an enable request for a path that is not in the list", () =>
    Effect.gen(function* () {
      const { extensionPath, browserSessions, make } = yield* setup();
      const fake = yield* browserSessions.create(makeFakeSession());
      const extensions = yield* make;

      const result = yield* extensions.setEnabled(extensionPath, true);
      assert.isNull(result.refusal);
      assert.deepStrictEqual(result.extensions, []);
      assert.strictEqual(fake.loadExtension.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("unloads an extension whose load finished after the timeout", () =>
    Effect.gen(function* () {
      const { extensionPath, browserSessions, make } = yield* setup();
      const started = yield* Deferred.make<void>();
      const fake = makeFakeSession();
      // Never settles within the test: Electron is still loading when the timeout fires.
      fake.loadExtension.mockImplementation(() => {
        Deferred.doneUnsafe(started, Effect.void);
        return new Promise(() => {});
      });
      yield* browserSessions.create(fake);
      const extensions = yield* make;

      const adding = yield* Effect.forkChild(extensions.add(extensionPath));
      yield* Deferred.await(started);
      yield* TestClock.adjust("16 seconds");
      const added = yield* Fiber.join(adding);
      assert.strictEqual(added.extensions[0]?.problem, "loadFailed");

      // Electron registers the extension after the timeout, without the service seeing an id.
      fake.getAllExtensions.mockReturnValue([{ id: "late-id", path: extensionPath }]);
      yield* extensions.setEnabled(extensionPath, false);
      assert.deepStrictEqual(fake.removeExtension.mock.calls, [["late-id"]]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes a late-arriving extension that was disabled while it loaded", () =>
    Effect.gen(function* () {
      const { extensionPath, browserSessions, make } = yield* setup();
      const started = yield* Deferred.make<void>();
      const removed = yield* Deferred.make<string>();
      const fake = makeFakeSession();
      let finishLoad: (extension: { id: string }) => void = () => {};
      fake.loadExtension.mockImplementation(() => {
        Deferred.doneUnsafe(started, Effect.void);
        return new Promise((resolve) => {
          finishLoad = resolve;
        });
      });
      fake.removeExtension.mockImplementation((id: string) => {
        Deferred.doneUnsafe(removed, Effect.succeed(id));
      });
      yield* browserSessions.create(fake);
      const extensions = yield* make;

      const adding = yield* Effect.forkChild(extensions.add(extensionPath));
      yield* Deferred.await(started);
      yield* TestClock.adjust("16 seconds");
      yield* Fiber.join(adding);
      yield* extensions.setEnabled(extensionPath, false);
      assert.strictEqual(fake.removeExtension.mock.calls.length, 0);

      finishLoad({ id: "late-id" });
      assert.strictEqual(yield* Deferred.await(removed), "late-id");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

const setupWithSource = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-browser-ext-source-" });
  const extensionsDirectory = path.join(root, "chrome", "Default", "Extensions");
  const otherExtensionsDirectory = path.join(root, "chrome", "Profile 1", "Extensions");
  const install = Effect.fnUntraced(function* (
    version: string,
    directory: string = extensionsDirectory,
  ) {
    const versionPath = path.join(directory, EXTENSION_ID, `${version}_0`);
    yield* fileSystem.makeDirectory(path.join(versionPath, "_locales", "en"), { recursive: true });
    yield* fileSystem.writeFileString(
      path.join(versionPath, "manifest.json"),
      manifest({ name: "__MSG_extName__", default_locale: "en", version }),
    );
    yield* fileSystem.writeFileString(
      path.join(versionPath, "_locales", "en", "messages.json"),
      JSON.stringify({ extName: { message: "Media Preview" } }),
    );
    return versionPath;
  });
  const copiesDirectory = path.join(root, "copies");
  const browserSessions = makeFakeBrowserSessions();
  const make = BrowserExtensions.makeAt(path.join(root, "state", "extensions.json"), {
    copiesDirectory,
    sourceProfiles: Effect.succeed([
      {
        sourceId: "chrome" as const,
        sourceName: "Chrome",
        directory: "Default",
        name: "Person 1",
        extensionsDirectory,
      },
      {
        sourceId: "chrome" as const,
        sourceName: "Chrome",
        directory: "Profile 1",
        name: "Person 2",
        extensionsDirectory: otherExtensionsDirectory,
      },
    ]),
  }).pipe(Effect.provideService(BrowserSession.BrowserSession, browserSessions.service));
  const addFromChrome = { sourceId: "chrome", profileDirectory: "Default" } as const;
  return {
    fileSystem,
    path,
    extensionsDirectory,
    otherExtensionsDirectory,
    copiesDirectory,
    install,
    browserSessions,
    make,
    addFromChrome,
  };
});

const versionAt = Effect.fnUntraced(function* (extensionPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fileSystem.readFileString(path.join(extensionPath, "manifest.json"));
  return BrowserExtensionManifest.parseExtensionManifest(raw)?.version;
});

// fs.cp refuses a FIFO even as root, which ignores chmod; the manifest still reads fine.
const uncopyableFileIn = Effect.fnUntraced(function* (versionPath: string) {
  const path = yield* Path.Path;
  NodeChildProcess.execFileSync("mkfifo", [path.join(versionPath, "background.js")]);
});

describe("BrowserExtensions copied from another browser", () => {
  it.effect(
    "listSources should offer the newest installed version under its localized name when a browser profile has extensions",
    () =>
      Effect.gen(function* () {
        const { install, make } = yield* setupWithSource();
        yield* install("1.9.0");
        yield* install("1.10.0");
        const extensions = yield* make;

        assert.deepStrictEqual(yield* extensions.listSources, [
          {
            id: "chrome",
            name: "Chrome",
            profiles: [
              {
                directory: "Default",
                name: "Person 1",
                extensions: [
                  { extensionId: EXTENSION_ID, name: "Media Preview", version: "1.10.0" },
                ],
              },
            ],
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "addFromSource should load a copy that remembers its browser when an extension is added from one",
    () =>
      Effect.gen(function* () {
        const { copiesDirectory, install, browserSessions, make, addFromChrome } =
          yield* setupWithSource();
        yield* install("1.0.0");
        const fake = yield* browserSessions.create(makeFakeSession());
        const extensions = yield* make;

        const added = yield* extensions.addFromSource({
          ...addFromChrome,
          extensionIds: [EXTENSION_ID],
        });

        const [status] = added.extensions;
        assert.isNull(added.refusal);
        assert.isTrue(status?.path.startsWith(copiesDirectory));
        assert.strictEqual(status?.name, "Media Preview");
        assert.deepStrictEqual(status?.source, {
          sourceId: "chrome",
          sourceName: "Chrome",
          profileDirectory: "Default",
          profileName: "Person 1",
          extensionId: EXTENSION_ID,
        });
        assert.deepStrictEqual(fake.loadExtension.mock.calls, [
          [status?.path, { allowFileAccess: false }],
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "addFromSource should read nothing when the profile is not one this machine listed",
    () =>
      Effect.gen(function* () {
        const { install, make } = yield* setupWithSource();
        yield* install("1.0.0");
        const extensions = yield* make;

        const added = yield* extensions.addFromSource({
          sourceId: "chrome",
          profileDirectory: "../Default",
          extensionIds: [EXTENSION_ID],
        });
        assert.deepStrictEqual(added.extensions, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "updateFromSources should reload the copy from the same path when its browser installed a newer version",
    () =>
      Effect.gen(function* () {
        const { install, browserSessions, make, addFromChrome } = yield* setupWithSource();
        yield* install("1.0.0");
        const fake = yield* browserSessions.create(makeFakeSession());
        const extensions = yield* make;
        const added = yield* extensions.addFromSource({
          ...addFromChrome,
          extensionIds: [EXTENSION_ID],
        });
        const copyPath = added.extensions[0]!.path;

        yield* install("2.0.0");
        const first = yield* extensions.updateFromSources;
        const second = yield* extensions.updateFromSources;

        assert.deepStrictEqual(first.updated, [{ name: "Media Preview", version: "2.0.0" }]);
        assert.deepStrictEqual(second.updated, []);
        assert.strictEqual(yield* versionAt(copyPath), "2.0.0");
        assert.deepStrictEqual(fake.removeExtension.mock.calls, [[`id:${copyPath}`]]);
        assert.deepStrictEqual(
          fake.loadExtension.mock.calls.map(([loadedPath]) => loadedPath),
          [copyPath, copyPath],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "updateFromSources should keep the copy working and flag it when the browser no longer has the extension",
    () =>
      Effect.gen(function* () {
        const { fileSystem, path, extensionsDirectory, install, make, addFromChrome } =
          yield* setupWithSource();
        yield* install("1.0.0");
        const extensions = yield* make;
        const added = yield* extensions.addFromSource({
          ...addFromChrome,
          extensionIds: [EXTENSION_ID],
        });
        yield* fileSystem.remove(path.join(extensionsDirectory, EXTENSION_ID), { recursive: true });

        const result = yield* extensions.updateFromSources;

        assert.deepStrictEqual(result.updated, []);
        assert.strictEqual(result.extensions[0]?.problem, "sourceMissing");
        assert.strictEqual(yield* versionAt(added.extensions[0]!.path), "1.0.0");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("remove should delete the copied folder when a copied extension is removed", () =>
    Effect.gen(function* () {
      const { fileSystem, install, make, addFromChrome } = yield* setupWithSource();
      yield* install("1.0.0");
      const extensions = yield* make;
      const added = yield* extensions.addFromSource({
        ...addFromChrome,
        extensionIds: [EXTENSION_ID],
      });
      const copyPath = added.extensions[0]!.path;

      yield* extensions.remove(copyPath);

      assert.isFalse(yield* fileSystem.exists(copyPath));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "updateFromSources should load the new version when a session is still loading the old copy",
    () =>
      Effect.gen(function* () {
        const { install, browserSessions, make, addFromChrome } = yield* setupWithSource();
        yield* install("1.0.0");
        const extensions = yield* make;
        const added = yield* extensions.addFromSource({
          ...addFromChrome,
          extensionIds: [EXTENSION_ID],
        });
        const copyPath = added.extensions[0]!.path;
        yield* install("2.0.0");

        // As at startup: a restored session is still loading the copy when the update runs.
        const started = yield* Deferred.make<void>();
        const calls: Array<string> = [];
        let finishFirstLoad: () => void = () => {};
        const fake = makeFakeSession();
        fake.removeExtension.mockImplementation(() => calls.push("remove"));
        fake.loadExtension.mockImplementation(async (loadedPath: string) => {
          calls.push("load");
          if (fake.loadExtension.mock.calls.length === 1) {
            await new Promise<void>((resolve) => {
              finishFirstLoad = resolve;
              Deferred.doneUnsafe(started, Effect.void);
            });
          }
          return { id: `id:${loadedPath}` };
        });
        const creating = yield* Effect.forkChild(browserSessions.create(fake));
        yield* Deferred.await(started);
        browserSessions.hooks.onSessionsRead = () => finishFirstLoad();

        const result = yield* extensions.updateFromSources;
        yield* Fiber.join(creating);

        assert.deepStrictEqual(result.updated, [{ name: "Media Preview", version: "2.0.0" }]);
        // The old copy is unloaded only once its load lands, then loaded again from the new files.
        assert.deepStrictEqual(calls, ["load", "remove", "load"]);
        assert.deepStrictEqual(fake.removeExtension.mock.calls, [[`id:${copyPath}`]]);
        assert.strictEqual(yield* versionAt(copyPath), "2.0.0");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "updateFromSources should leave the running copy loaded and flag it when the newer version cannot be copied",
    () =>
      Effect.gen(function* () {
        const { fileSystem, install, browserSessions, make, addFromChrome } =
          yield* setupWithSource();
        yield* install("1.0.0");
        const fake = yield* browserSessions.create(makeFakeSession());
        const extensions = yield* make;
        const added = yield* extensions.addFromSource({
          ...addFromChrome,
          extensionIds: [EXTENSION_ID],
        });
        const copyPath = added.extensions[0]!.path;
        const newer = yield* install("2.0.0");
        yield* uncopyableFileIn(newer);

        const result = yield* extensions.updateFromSources;

        assert.deepStrictEqual(result.updated, []);
        assert.strictEqual(result.extensions[0]?.problem, "updateFailed");
        assert.strictEqual(yield* versionAt(copyPath), "1.0.0");
        assert.isFalse(yield* fileSystem.exists(`${copyPath}.incoming`));
        assert.strictEqual(fake.removeExtension.mock.calls.length, 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("addFromSource should report copyFailed when a picked extension cannot be copied", () =>
    Effect.gen(function* () {
      const { install, make, addFromChrome } = yield* setupWithSource();
      yield* uncopyableFileIn(yield* install("1.0.0"));
      const extensions = yield* make;

      const added = yield* extensions.addFromSource({
        ...addFromChrome,
        extensionIds: [EXTENSION_ID],
      });

      assert.strictEqual(added.refusal, "copyFailed");
      assert.deepStrictEqual(added.extensions, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("addFromSource should skip an extension already copied from another profile", () =>
    Effect.gen(function* () {
      const { install, otherExtensionsDirectory, make, addFromChrome } = yield* setupWithSource();
      yield* install("1.0.0");
      yield* install("1.0.0", otherExtensionsDirectory);
      const extensions = yield* make;
      yield* extensions.addFromSource({ ...addFromChrome, extensionIds: [EXTENSION_ID] });

      const again = yield* extensions.addFromSource({
        sourceId: "chrome",
        profileDirectory: "Profile 1",
        extensionIds: [EXTENSION_ID],
      });

      assert.deepStrictEqual(
        again.extensions.map((status) => status.source?.profileDirectory),
        ["Default"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
