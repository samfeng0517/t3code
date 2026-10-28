import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  BrowserBookmarkReadError,
  listBookmarkSources,
  normalizeChromiumBookmarks,
  readBookmarks,
} from "./ChromiumBookmarks.ts";
import { BROWSER_IMPORT_SOURCES, sourcePathContext } from "./Sources.ts";

const helium = BROWSER_IMPORT_SOURCES.find((source) => source.id === "helium")!;

// Shaped like Chrome's `<profile>/Bookmarks` file, trimmed to the fields the reader uses plus a
// few it must ignore.
const CHROME_BOOKMARKS_FIXTURE = {
  checksum: "0123456789abcdef",
  roots: {
    bookmark_bar: {
      children: [
        {
          date_added: "13300000000000000",
          guid: "00000000-0000-4000-8000-000000000001",
          id: "5",
          name: "T3 Code",
          type: "url",
          url: "https://t3.codes/",
        },
        {
          children: [
            { id: "7", name: "Effect docs", type: "url", url: "https://effect.website/docs" },
            {
              children: [{ id: "9", name: "", type: "url", url: "https://example.com/deep" }],
              id: "8",
              name: "Nested",
              type: "folder",
            },
            { id: "10", name: "Bookmarklet", type: "url", url: "javascript:alert(1)" },
            { id: "11", name: "Settings", type: "url", url: "chrome://settings" },
          ],
          id: "6",
          name: "Work",
          type: "folder",
        },
      ],
      id: "1",
      name: "Bookmarks bar",
      type: "folder",
    },
    other: {
      children: [{ id: "12", name: "Later", type: "url", url: "http://localhost:3000/" }],
      id: "2",
      name: "Other bookmarks",
      type: "folder",
    },
    synced: { children: [], id: "3", name: "Mobile bookmarks", type: "folder" },
  },
  version: 1,
};

const EXPECTED_ROOTS = [
  {
    title: "Bookmarks bar",
    children: [
      { title: "T3 Code", url: "https://t3.codes/" },
      {
        title: "Work",
        children: [
          { title: "Effect docs", url: "https://effect.website/docs" },
          { title: "Nested", children: [{ title: "", url: "https://example.com/deep" }] },
        ],
      },
    ],
  },
  { title: "Other bookmarks", children: [{ title: "Later", url: "http://localhost:3000/" }] },
];

describe("normalizeChromiumBookmarks", () => {
  it("should keep the folder structure and web bookmarks when reading a Chrome bookmarks file", () => {
    assert.deepEqual(normalizeChromiumBookmarks(CHROME_BOOKMARKS_FIXTURE), EXPECTED_ROOTS);
  });

  it("should return no roots when the file is not a bookmarks file", () => {
    assert.deepEqual(normalizeChromiumBookmarks(null), []);
    assert.deepEqual(normalizeChromiumBookmarks({ roots: "junk" }), []);
    assert.deepEqual(normalizeChromiumBookmarks({ roots: { bookmark_bar: { children: 4 } } }), []);
  });
});

const withSourceHome = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-bookmarks-" });
  const context = yield* sourcePathContext.pipe(
    Effect.provideService(HostProcess.Environment, { HOME: home }),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
  const root = helium.userDataDirectory(context);
  if (root === undefined) throw new Error("Helium has no macOS user-data directory");
  yield* fileSystem.makeDirectory(`${root}/Default`, { recursive: true });
  yield* fileSystem.makeDirectory(`${root}/Profile 2`, { recursive: true });
  yield* fileSystem.writeFileString(
    `${root}/Local State`,
    `{"profile":{"info_cache":{"Default":{"name":"Personal"},"Profile 2":{"name":"Work"}}}}`,
  );
  yield* fileSystem.writeFileString(
    `${root}/Default/Bookmarks`,
    JSON.stringify(CHROME_BOOKMARKS_FIXTURE),
  );
  return { context, home, root };
});

describe("listBookmarkSources", () => {
  it.effect("should list only profiles that have a bookmarks file", () =>
    Effect.gen(function* () {
      const { context } = yield* withSourceHome();
      assert.deepEqual(yield* listBookmarkSources(context), [
        { id: "helium", name: helium.name, profiles: [{ directory: "Default", name: "Personal" }] },
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("listBookmarkSources on Windows", () => {
  it.effect("should list Chrome, Edge, and Brave profiles from Local AppData", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-bookmarks-win-" });
      const localAppData = `${home}/AppData/Local`;
      const context = yield* sourcePathContext.pipe(
        Effect.provideService(HostProcess.Environment, {
          USERPROFILE: home,
          LOCALAPPDATA: localAppData,
        }),
        Effect.provideService(HostProcess.Platform, "win32"),
      );
      for (const segments of [
        ["Google", "Chrome", "User Data"],
        ["Microsoft", "Edge", "User Data"],
        ["BraveSoftware", "Brave-Browser", "User Data"],
      ]) {
        const root = `${localAppData}/${segments.join("/")}`;
        yield* fileSystem.makeDirectory(`${root}/Default`, { recursive: true });
        yield* fileSystem.writeFileString(
          `${root}/Local State`,
          `{"profile":{"info_cache":{"Default":{"name":"Personal"}}}}`,
        );
        yield* fileSystem.writeFileString(`${root}/Default/Bookmarks`, "{}");
      }

      const sources = yield* listBookmarkSources(context);
      assert.deepEqual(
        sources.map((source) => source.id),
        ["chrome", "edge", "brave"],
      );
      const read = yield* readBookmarks(context, {
        sourceId: "edge",
        sourceProfileDirectory: "Default",
      });
      assert.deepEqual(read, { roots: [] });
      // Cookie import keeps refusing these browsers on Windows (app-bound encryption).
      assert.equal(
        BROWSER_IMPORT_SOURCES.find((source) => source.id === "chrome")!.userDataDirectory(context),
        undefined,
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("readBookmarks", () => {
  it.effect("should return the normalized roots when reading a listed profile", () =>
    Effect.gen(function* () {
      const { context } = yield* withSourceHome();
      const result = yield* readBookmarks(context, {
        sourceId: "helium",
        sourceProfileDirectory: "Default",
      });
      assert.deepEqual(result, { roots: EXPECTED_ROOTS });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("should reject a profile directory the browser never reported", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { context, home } = yield* withSourceHome();
      yield* fileSystem.makeDirectory(`${home}/secrets`, { recursive: true });
      yield* fileSystem.writeFileString(`${home}/secrets/Bookmarks`, "{}");

      const error = yield* readBookmarks(context, {
        sourceId: "helium",
        sourceProfileDirectory: "../../../../secrets",
      }).pipe(Effect.flip);

      assert.instanceOf(error, BrowserBookmarkReadError);
      assert.equal(error.reason, "unknownSourceProfile");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("should fail with readFailed when the bookmarks file is not JSON", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { context, root } = yield* withSourceHome();
      yield* fileSystem.writeFileString(`${root}/Default/Bookmarks`, "{not-json");

      const error = yield* readBookmarks(context, {
        sourceId: "helium",
        sourceProfileDirectory: "Default",
      }).pipe(Effect.flip);

      assert.equal(error.reason, "readFailed");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
