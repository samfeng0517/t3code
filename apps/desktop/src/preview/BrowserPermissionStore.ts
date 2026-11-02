import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

export const makePermissionStore = Effect.fn("BrowserPermissionStore.make")(function* <
  Site,
  Encoded,
>(options: {
  readonly storePath: string;
  readonly site: Schema.Codec<Site, Encoded>;
  readonly keyOf: (site: Site) => string;
  readonly compare: (left: Site, right: Site) => number;
  readonly label: string;
}) {
  const { storePath, keyOf, compare, label } = options;
  const document = Schema.fromJsonString(Schema.Struct({ sites: Schema.Array(options.site) }));
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const initial = yield* fileSystem.readFileString(storePath).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(document)),
    Effect.map((decoded) => decoded.sites),
    Effect.catch((cause) =>
      cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
        ? Effect.succeed([])
        : Effect.logWarning(`Could not read ${label}.`, cause).pipe(Effect.as([])),
    ),
  );
  const sites = new Map(initial.map((site) => [keyOf(site), site] as const));

  const list = Effect.sync(() => [...sites.values()].toSorted(compare));
  const writeLock = yield* Semaphore.make(1);
  // A failed write keeps the in-memory answer for this run rather than prompting again.
  const persist = list.pipe(
    Effect.flatMap((current) => Schema.encodeEffect(document)({ sites: current })),
    Effect.flatMap((encoded) =>
      Effect.gen(function* () {
        const tempPath = `${storePath}.${process.pid}.tmp`;
        yield* fileSystem.makeDirectory(path.dirname(storePath), { recursive: true });
        yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
        yield* fileSystem.rename(tempPath, storePath);
      }),
    ),
    Effect.catch((cause) => Effect.logWarning(`Could not save ${label}.`, cause)),
    // Writers share one temp file, so they take turns.
    writeLock.withPermits(1),
  );

  return {
    get: (key: string) => sites.get(key),
    put: (site: Site) =>
      Effect.suspend(() => {
        sites.set(keyOf(site), site);
        return persist;
      }),
    delete: (key: string) =>
      Effect.suspend(() => {
        sites.delete(key);
        return Effect.andThen(persist, list);
      }),
    list,
  };
});
