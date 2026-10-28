import {
  BROWSER_EXTENSION_MAX_COUNT,
  type BrowserExtensionAddFromSourceInput,
  type BrowserExtensionMutationResult,
  type BrowserExtensionProblem,
  type BrowserExtensionRefusal,
  BrowserExtensionSource,
  type BrowserExtensionSourceBrowser,
  type BrowserExtensionStatus,
  type BrowserExtensionUpdateResult,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import type { Session } from "electron";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  compareExtensionVersions,
  extensionDisplayName,
  type ParsedExtensionManifest,
  readExtensionManifest,
} from "./BrowserExtensionManifest.ts";
import {
  type ExtensionSourceProfile,
  listExtensionSourceProfiles,
  listInstalledExtensions,
  readInstalledExtension,
} from "./BrowserExtensionSources.ts";
import { sourcePathContext } from "./BrowserImport/Sources.ts";
import * as BrowserSession from "./BrowserSession.ts";

export interface BrowserExtensionEntry {
  readonly path: string;
  readonly enabled: boolean;
  /** Set when the folder is a copy kept in sync with another browser's install. */
  readonly source?: BrowserExtensionSource;
}

const BrowserExtensionsDocument = Schema.Struct({
  extensions: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      enabled: Schema.optionalKey(Schema.Boolean),
      source: Schema.optionalKey(BrowserExtensionSource),
    }),
  ),
});
const BrowserExtensionsJson = fromLenientJson(BrowserExtensionsDocument);
const decodeDocument = Schema.decodeOption(BrowserExtensionsJson);
const encodeDocument = Schema.encodeEffect(BrowserExtensionsJson);

/** Drops blank and duplicate paths, keeping the first, and caps the list. */
export function normalizeExtensionEntries(
  entries: ReadonlyArray<{
    readonly path: string;
    readonly enabled?: boolean;
    readonly source?: BrowserExtensionSource;
  }>,
): ReadonlyArray<BrowserExtensionEntry> {
  const seen = new Set<string>();
  const normalized: Array<BrowserExtensionEntry> = [];
  for (const entry of entries) {
    const path = entry.path.trim();
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    normalized.push({
      path,
      enabled: entry.enabled ?? true,
      ...(entry.source === undefined ? {} : { source: entry.source }),
    });
    if (normalized.length === BROWSER_EXTENSION_MAX_COUNT) break;
  }
  return normalized;
}

export function decodeExtensionEntries(raw: string): ReadonlyArray<BrowserExtensionEntry> {
  return Option.match(decodeDocument(raw), {
    onNone: () => [],
    onSome: (document) => normalizeExtensionEntries(document.extensions),
  });
}

export function addExtensionEntry(
  entries: ReadonlyArray<BrowserExtensionEntry>,
  path: string,
  source?: BrowserExtensionSource,
):
  | { readonly entries: ReadonlyArray<BrowserExtensionEntry> }
  | { readonly refusal: BrowserExtensionRefusal } {
  if (entries.some((entry) => entry.path === path)) return { refusal: "alreadyAdded" };
  if (entries.length >= BROWSER_EXTENSION_MAX_COUNT) return { refusal: "limitReached" };
  return {
    entries: [...entries, { path, enabled: true, ...(source === undefined ? {} : { source }) }],
  };
}

/** One path segment safe on every platform, so a profile name cannot climb out of its folder. */
const copyFolderSegment = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+$/, "_");

export function setExtensionEntryEnabled(
  entries: ReadonlyArray<BrowserExtensionEntry>,
  path: string,
  enabled: boolean,
): ReadonlyArray<BrowserExtensionEntry> {
  return entries.map((entry) => (entry.path === path ? { ...entry, enabled } : entry));
}

export function removeExtensionEntry(
  entries: ReadonlyArray<BrowserExtensionEntry>,
  path: string,
): ReadonlyArray<BrowserExtensionEntry> {
  return entries.filter((entry) => entry.path !== path);
}

export class BrowserExtensionsWriteError extends Schema.TaggedError<BrowserExtensionsWriteError>()(
  "BrowserExtensionsWriteError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to save the browser extension list at ${this.path}.`;
  }
}

class BrowserExtensionLoadError extends Schema.TaggedError<BrowserExtensionLoadError>()(
  "BrowserExtensionLoadError",
  { detail: Schema.String },
) {}

export class BrowserExtensions extends Context.Service<
  BrowserExtensions,
  {
    readonly list: Effect.Effect<ReadonlyArray<BrowserExtensionStatus>>;
    readonly add: (
      path: string,
    ) => Effect.Effect<BrowserExtensionMutationResult, BrowserExtensionsWriteError>;
    readonly setEnabled: (
      path: string,
      enabled: boolean,
    ) => Effect.Effect<BrowserExtensionMutationResult, BrowserExtensionsWriteError>;
    readonly remove: (
      path: string,
    ) => Effect.Effect<BrowserExtensionMutationResult, BrowserExtensionsWriteError>;
    readonly listSources: Effect.Effect<ReadonlyArray<BrowserExtensionSourceBrowser>>;
    readonly addFromSource: (
      input: BrowserExtensionAddFromSourceInput,
    ) => Effect.Effect<BrowserExtensionMutationResult, BrowserExtensionsWriteError>;
    /** Swaps in each copy's newer browser version while the app runs. */
    readonly updateFromSources: Effect.Effect<BrowserExtensionUpdateResult>;
  }
>()("@t3tools/desktop/preview/BrowserExtensions") {}

const BROWSER_EXTENSION_COPIES_DIRECTORY = "browser-extension-copies";

// A load that never settles would hold the session lock and stall every tab.
const LOAD_TIMEOUT = Duration.seconds(15);

const errorDetail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const makeAt = Effect.fn("BrowserExtensions.make")(function* (
  storePath: string,
  options: {
    /** Where copies from other browsers live; defaults beside the store. */
    readonly copiesDirectory?: string;
    readonly sourceProfiles?: Effect.Effect<ReadonlyArray<ExtensionSourceProfile>>;
  } = {},
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const browserSessions = yield* BrowserSession.BrowserSession;
  const copiesDirectory =
    options.copiesDirectory ??
    path.join(path.dirname(storePath), BROWSER_EXTENSION_COPIES_DIRECTORY);
  const sourceProfiles = options.sourceProfiles ?? Effect.succeed([]);
  const withPlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  // Copies, swaps and removals touch the same folders, so they take turns.
  const copyLock = yield* Semaphore.make(1);
  const missingSources = new Set<string>();
  const updateFailures = new Map<string, string>();

  const initial = yield* fileSystem.readFileString(storePath).pipe(
    Effect.map(decodeExtensionEntries),
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed<ReadonlyArray<BrowserExtensionEntry>>([])
        : Effect.logWarning("Could not read the browser extension list.", cause).pipe(
            Effect.as<ReadonlyArray<BrowserExtensionEntry>>([]),
          ),
    ),
  );
  const entriesRef = yield* SynchronizedRef.make(initial);
  const loadFailures = new Map<string, string>();
  const loadedIds = new WeakMap<Session, Map<string, string>>();
  const loadsInFlight = new WeakMap<Session, Map<string, Deferred.Deferred<void>>>();

  const persist = Effect.fn("BrowserExtensions.persist")(
    function* (entries: ReadonlyArray<BrowserExtensionEntry>) {
      const encoded = yield* encodeDocument({
        extensions: entries.map(({ path: entryPath, enabled, source }) => ({
          path: entryPath,
          enabled,
          ...(source === undefined ? {} : { source }),
        })),
      });
      const tempPath = `${storePath}.${process.pid}.tmp`;
      yield* fileSystem.makeDirectory(path.dirname(storePath), { recursive: true });
      yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
      yield* fileSystem.rename(tempPath, storePath);
    },
    Effect.mapError((cause) => new BrowserExtensionsWriteError({ path: storePath, cause })),
  );

  // Runs detached from `loadInto`: the 15s timeout abandons the wait, not the load, so Electron
  // can still finish it afterwards. Whoever sees the extension arrive late must record or undo it.
  const loadAndRecord = (browserSession: Session, extensionPath: string) =>
    Effect.tryPromise({
      try: () => browserSession.extensions.loadExtension(extensionPath, { allowFileAccess: false }),
      // Electron's message is the only explanation the user gets for a refused extension.
      catch: (cause) => new BrowserExtensionLoadError({ detail: errorDetail(cause) }),
    }).pipe(
      Effect.flatMap((extension) =>
        SynchronizedRef.get(entriesRef).pipe(
          Effect.map((entries) => {
            const wanted = entries.some((entry) => entry.path === extensionPath && entry.enabled);
            if (wanted) {
              loadedIds.get(browserSession)?.set(extensionPath, extension.id);
              loadFailures.delete(extensionPath);
              return;
            }
            try {
              browserSession.extensions.removeExtension(extension.id);
            } catch {
              // Already gone from the session; nothing left to unload.
            }
          }),
        ),
      ),
    );

  const loadInto = Effect.fn("BrowserExtensions.loadInto")(
    function* (browserSession: Session, extensionPath: string) {
      const gate = yield* Deferred.make<void>();
      const loaded = loadedIds.get(browserSession) ?? new Map<string, string>();
      loadedIds.set(browserSession, loaded);
      const inFlight =
        loadsInFlight.get(browserSession) ?? new Map<string, Deferred.Deferred<void>>();
      loadsInFlight.set(browserSession, inFlight);
      if (loaded.has(extensionPath)) return;
      // A session can be reached by both its initializer and a concurrent add; Electron
      // refuses a second load of the same path, so the later caller waits for the first.
      const running = inFlight.get(extensionPath);
      if (running !== undefined) return yield* Deferred.await(running);
      inFlight.set(extensionPath, gate);
      const settled = Effect.sync(() => inFlight.delete(extensionPath)).pipe(
        Effect.andThen(Deferred.succeed(gate, undefined)),
      );
      const loading = yield* Effect.forkDetach(loadAndRecord(browserSession, extensionPath));
      yield* Fiber.join(loading).pipe(
        Effect.timeout(LOAD_TIMEOUT),
        Effect.catchTags({
          TimeoutError: (cause) =>
            Effect.fail(new BrowserExtensionLoadError({ detail: errorDetail(cause) })),
        }),
        Effect.ensuring(settled),
      );
    },
    (effect, _browserSession, extensionPath) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.sync(() => loadFailures.set(extensionPath, cause.detail)).pipe(
            Effect.andThen(
              Effect.logWarning("Could not load a browser extension.", cause).pipe(
                Effect.annotateLogs({ extensionPath }),
              ),
            ),
          ),
        ),
      ),
  );

  const unloadFrom = (browserSession: Session, extensionPath: string) =>
    Effect.sync(() => {
      const loaded = loadedIds.get(browserSession);
      const extensionIds = new Set<string>();
      const trackedId = loaded?.get(extensionPath);
      if (trackedId !== undefined) extensionIds.add(trackedId);
      loaded?.delete(extensionPath);
      // A load that outlived its timeout was never tracked, but Electron still lists it.
      try {
        for (const extension of browserSession.extensions.getAllExtensions()) {
          if (extension.path === extensionPath) extensionIds.add(extension.id);
        }
      } catch {
        // Fall back to the tracked id alone.
      }
      for (const extensionId of extensionIds) {
        try {
          browserSession.extensions.removeExtension(extensionId);
        } catch {
          // Already gone from the session; nothing left to unload.
        }
      }
    });

  const forEachSession = (run: (browserSession: Session) => Effect.Effect<void>) =>
    browserSessions.persistentSessions.pipe(
      Effect.flatMap((sessions) => Effect.forEach(sessions, run, { discard: true })),
    );

  yield* browserSessions.addPersistentSessionInitializer((browserSession) =>
    SynchronizedRef.get(entriesRef).pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries.filter((entry) => entry.enabled),
          (entry) => loadInto(browserSession, entry.path),
          { concurrency: "unbounded", discard: true },
        ),
      ),
    ),
  );

  const readManifest = (extensionPath: string) =>
    withPlatform(readExtensionManifest(extensionPath));
  const displayName = (extensionPath: string, manifest: ParsedExtensionManifest) =>
    withPlatform(extensionDisplayName(extensionPath, manifest));

  const statusOf = Effect.fn("BrowserExtensions.statusOf")(function* (
    entry: BrowserExtensionEntry,
  ) {
    const manifest = yield* readManifest(entry.path);
    if (typeof manifest === "string") {
      return {
        path: entry.path,
        enabled: entry.enabled,
        name: null,
        version: null,
        manifestVersion: null,
        problem: manifest,
        detail: null,
        ...(entry.source === undefined ? {} : { source: entry.source }),
      } satisfies BrowserExtensionStatus;
    }
    const loadFailure = entry.enabled ? loadFailures.get(entry.path) : undefined;
    const updateFailure = updateFailures.get(entry.path);
    const failure = loadFailure ?? updateFailure;
    const problem: BrowserExtensionProblem | null =
      loadFailure !== undefined
        ? "loadFailed"
        : updateFailure !== undefined
          ? "updateFailed"
          : missingSources.has(entry.path)
            ? "sourceMissing"
            : null;
    return {
      path: entry.path,
      enabled: entry.enabled,
      name: yield* displayName(entry.path, manifest),
      version: manifest.version,
      manifestVersion: manifest.manifestVersion,
      problem,
      detail: failure ?? null,
      ...(entry.source === undefined ? {} : { source: entry.source }),
    } satisfies BrowserExtensionStatus;
  });

  const list = SynchronizedRef.get(entriesRef).pipe(
    Effect.flatMap((entries) => Effect.forEach(entries, statusOf)),
  );
  const result = (refusal: BrowserExtensionRefusal | null) =>
    list.pipe(Effect.map((extensions) => ({ extensions, refusal })));

  const add = Effect.fn("BrowserExtensions.add")(function* (rawPath: string) {
    const extensionPath = path.resolve(rawPath);
    const manifest = yield* readManifest(extensionPath);
    if (typeof manifest === "string") return yield* result(manifest);
    const refusal = yield* SynchronizedRef.modifyEffect(entriesRef, (entries) => {
      const next = addExtensionEntry(entries, extensionPath);
      if ("refusal" in next) return Effect.succeed([next.refusal, entries] as const);
      return persist(next.entries).pipe(Effect.as([null, next.entries] as const));
    });
    if (refusal !== null) return yield* result(refusal);
    yield* forEachSession((browserSession) => loadInto(browserSession, extensionPath));
    return yield* result(null);
  });

  const setEnabled = Effect.fn("BrowserExtensions.setEnabled")(function* (
    extensionPath: string,
    enabled: boolean,
  ) {
    const known = yield* SynchronizedRef.modifyEffect(entriesRef, (entries) => {
      if (!entries.some((entry) => entry.path === extensionPath)) {
        return Effect.succeed([false, entries] as const);
      }
      const next = setExtensionEntryEnabled(entries, extensionPath, enabled);
      return persist(next).pipe(Effect.as([true, next] as const));
    });
    if (!known) return yield* result(null);
    if (enabled) {
      // A retry after a failed load must reach Electron again.
      loadFailures.delete(extensionPath);
      yield* forEachSession((browserSession) => loadInto(browserSession, extensionPath));
    } else {
      yield* forEachSession((browserSession) => unloadFrom(browserSession, extensionPath));
    }
    return yield* result(null);
  });

  const copyPathFor = (source: BrowserExtensionSource) =>
    path.join(
      copiesDirectory,
      source.sourceId,
      copyFolderSegment(source.profileDirectory),
      source.extensionId,
    );

  // Only the folder this service derived from the source is ever replaced or deleted, whatever
  // path the stored list claims.
  const isCopy = (
    entry: BrowserExtensionEntry | undefined,
  ): entry is BrowserExtensionEntry & { readonly source: BrowserExtensionSource } =>
    entry?.source !== undefined && entry.path === copyPathFor(entry.source);

  const remove = Effect.fn("BrowserExtensions.remove")(function* (extensionPath: string) {
    const removed = yield* SynchronizedRef.modifyEffect(entriesRef, (entries) => {
      const entry = entries.find((candidate) => candidate.path === extensionPath);
      const next = removeExtensionEntry(entries, extensionPath);
      return persist(next).pipe(Effect.as([entry, next] as const));
    });
    loadFailures.delete(extensionPath);
    missingSources.delete(extensionPath);
    updateFailures.delete(extensionPath);
    yield* forEachSession((browserSession) => unloadFrom(browserSession, extensionPath));
    if (isCopy(removed)) {
      yield* copyLock.withPermits(1)(
        fileSystem
          .remove(extensionPath, { recursive: true })
          .pipe(Effect.ignore, Effect.andThen(discardStaged(extensionPath))),
      );
    }
    return yield* result(null);
  });

  // A copy lands next to its target first, so a failed copy leaves the old version in place.
  const stagedPathFor = (target: string) => `${target}.incoming`;
  const discardStaged = (target: string) =>
    fileSystem.remove(stagedPathFor(target), { recursive: true, force: true }).pipe(Effect.ignore);
  const stageCopy = (from: string, to: string) =>
    fileSystem.remove(stagedPathFor(to), { recursive: true, force: true }).pipe(
      Effect.andThen(fileSystem.makeDirectory(path.dirname(to), { recursive: true })),
      Effect.andThen(fileSystem.copy(from, stagedPathFor(to))),
      Effect.tapError(() => discardStaged(to)),
    );
  const swapStaged = (target: string) =>
    fileSystem
      .remove(target, { recursive: true, force: true })
      .pipe(Effect.andThen(fileSystem.rename(stagedPathFor(target), target)));

  const listSources = sourceProfiles.pipe(
    Effect.flatMap((profiles) =>
      Effect.forEach(profiles, (profile) =>
        withPlatform(listInstalledExtensions(profile.extensionsDirectory)).pipe(
          Effect.map((installed) => ({ profile, installed })),
        ),
      ),
    ),
    Effect.map((found) => {
      const browsers = new Map<string, BrowserExtensionSourceBrowser>();
      for (const { profile, installed } of found) {
        if (installed.length === 0) continue;
        const browser = browsers.get(profile.sourceId) ?? {
          id: profile.sourceId,
          name: profile.sourceName,
          profiles: [],
        };
        browsers.set(profile.sourceId, {
          ...browser,
          profiles: [
            ...browser.profiles,
            {
              directory: profile.directory,
              name: profile.name,
              extensions: installed.map(({ extensionId, name, version }) => ({
                extensionId,
                name,
                version,
              })),
            },
          ],
        });
      }
      return [...browsers.values()];
    }),
  );

  const addFromSource = Effect.fn("BrowserExtensions.addFromSource")(function* (
    input: BrowserExtensionAddFromSourceInput,
  ) {
    // The profile arrives over IPC, so only one this machine listed is read from.
    const profile = (yield* sourceProfiles).find(
      (candidate) =>
        candidate.sourceId === input.sourceId && candidate.directory === input.profileDirectory,
    );
    if (profile === undefined) return yield* result(null);
    let refusal: BrowserExtensionRefusal | null = null;
    const added: Array<string> = [];
    for (const extensionId of input.extensionIds) {
      const installed = yield* withPlatform(
        readInstalledExtension(profile.extensionsDirectory, extensionId),
      );
      if (installed === null) continue;
      const source: BrowserExtensionSource = {
        sourceId: profile.sourceId,
        sourceName: profile.sourceName,
        profileDirectory: profile.directory,
        profileName: profile.name,
        extensionId,
      };
      const target = copyPathFor(source);
      const current = yield* SynchronizedRef.get(entriesRef);
      // Copies of one extension share its id in Electron, so unloading either would unload both.
      if (current.some((entry) => entry.source?.extensionId === extensionId)) continue;
      const check = addExtensionEntry(current, target, source);
      if ("refusal" in check) {
        if (check.refusal === "limitReached") {
          refusal = "limitReached";
          break;
        }
        continue;
      }
      const copied = yield* copyLock
        .withPermits(1)(stageCopy(installed.path, target).pipe(Effect.andThen(swapStaged(target))))
        .pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("Could not copy a browser extension.", cause).pipe(
              Effect.annotateLogs({ extensionId, sourceId: profile.sourceId }),
              Effect.as(false),
            ),
          ),
        );
      if (!copied) {
        refusal = "copyFailed";
        continue;
      }
      yield* SynchronizedRef.updateEffect(entriesRef, (entries) => {
        const next = addExtensionEntry(entries, target, source);
        return "refusal" in next
          ? Effect.succeed(entries)
          : persist(next.entries).pipe(Effect.as(next.entries));
      });
      added.push(target);
    }
    for (const extensionPath of added) {
      yield* forEachSession((browserSession) => loadInto(browserSession, extensionPath));
    }
    return yield* result(refusal);
  });

  const awaitLoad = (browserSession: Session, extensionPath: string) => {
    const running = loadsInFlight.get(browserSession)?.get(extensionPath);
    return running === undefined ? Effect.void : Deferred.await(running);
  };

  const updateOne = Effect.fnUntraced(function* (
    extensionPath: string,
    profiles: ReadonlyArray<ExtensionSourceProfile>,
  ) {
    const findEntry = SynchronizedRef.get(entriesRef).pipe(
      Effect.map((entries) => entries.find((candidate) => candidate.path === extensionPath)),
    );
    // The entry may have been removed since this run read the list.
    const entry = yield* findEntry;
    if (!isCopy(entry)) return null;
    const profile = profiles.find(
      (candidate) =>
        candidate.sourceId === entry.source.sourceId &&
        candidate.directory === entry.source.profileDirectory,
    );
    const installed =
      profile === undefined
        ? null
        : yield* withPlatform(
            readInstalledExtension(profile.extensionsDirectory, entry.source.extensionId),
          );
    if (installed === null) {
      missingSources.add(entry.path);
      return null;
    }
    missingSources.delete(entry.path);
    const current = yield* readManifest(entry.path);
    // A copy whose folder went missing is restored quietly; it is not news to the user.
    const restoring = typeof current === "string";
    if (
      !restoring &&
      current.version !== null &&
      compareExtensionVersions(installed.version, current.version) <= 0
    ) {
      updateFailures.delete(entry.path);
      return null;
    }
    const recordFailure = (cause: unknown) =>
      Effect.sync(() => updateFailures.set(entry.path, errorDetail(cause))).pipe(
        Effect.andThen(Effect.logWarning("Could not update a browser extension.", cause)),
        Effect.annotateLogs({ extensionPath: entry.path }),
        Effect.as(false),
      );
    // Copied before anything is unloaded, so a failed copy leaves the running version alone.
    const staged = yield* stageCopy(installed.path, entry.path).pipe(
      Effect.as(true),
      Effect.catch(recordFailure),
    );
    if (!staged) return null;
    // Electron reads an extension's files as it runs, so it is unloaded before its folder is
    // swapped and loaded again from the same path, which keeps its id. A load still running,
    // as at startup, would otherwise read the old files and absorb the reload below.
    yield* forEachSession((browserSession) => awaitLoad(browserSession, entry.path));
    yield* forEachSession((browserSession) => unloadFrom(browserSession, entry.path));
    const swapped = yield* swapStaged(entry.path).pipe(
      Effect.as(true),
      Effect.catch(recordFailure),
    );
    const latest = yield* findEntry;
    if (latest?.enabled) {
      loadFailures.delete(entry.path);
      yield* forEachSession((browserSession) => loadInto(browserSession, entry.path));
    }
    if (!swapped) return null;
    updateFailures.delete(entry.path);
    return restoring || latest === undefined
      ? null
      : { name: installed.name, version: installed.version };
  });

  const updateFromSources = Effect.gen(function* () {
    const profiles = yield* sourceProfiles;
    const entries = yield* SynchronizedRef.get(entriesRef);
    const updated = yield* copyLock.withPermits(1)(
      Effect.forEach(entries.filter(isCopy), (entry) => updateOne(entry.path, profiles)),
    );
    return {
      extensions: yield* list,
      updated: updated.filter((update) => update !== null),
    } satisfies BrowserExtensionUpdateResult;
  }).pipe(Effect.withSpan("BrowserExtensions.updateFromSources"));

  return BrowserExtensions.of({
    list,
    add,
    setEnabled,
    remove,
    listSources,
    addFromSource,
    updateFromSources,
  });
});

export const BROWSER_EXTENSIONS_FILE_NAME = "browser-extensions.json";

export const layer = Layer.effect(
  BrowserExtensions,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const context = yield* sourcePathContext;
    return yield* makeAt(
      environment.path.join(environment.stateDir, BROWSER_EXTENSIONS_FILE_NAME),
      {
        sourceProfiles: listExtensionSourceProfiles(context).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      },
    );
  }),
);
