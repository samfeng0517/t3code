import {
  BrowserNotificationPermission,
  type BrowserNotificationDecision,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const PermissionsJson = Schema.fromJsonString(
  Schema.Struct({ sites: Schema.Array(BrowserNotificationPermission) }),
);
const decodeDocument = Schema.decodeUnknownEffect(PermissionsJson);
const encodeDocument = Schema.encodeEffect(PermissionsJson);

export class BrowserNotificationPermissions extends Context.Service<
  BrowserNotificationPermissions,
  {
    /** Synchronous because Electron's permission check handler cannot wait. */
    readonly decisionFor: (origin: string) => BrowserNotificationDecision | undefined;
    readonly set: (origin: string, decision: BrowserNotificationDecision) => Effect.Effect<void>;
    readonly remove: (
      origin: string,
    ) => Effect.Effect<ReadonlyArray<BrowserNotificationPermission>>;
    readonly list: Effect.Effect<ReadonlyArray<BrowserNotificationPermission>>;
  }
>()("@t3tools/desktop/preview/BrowserNotificationPermissions") {}

export const makeAt = Effect.fn("BrowserNotificationPermissions.make")(function* (
  storePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const initial = yield* fileSystem.readFileString(storePath).pipe(
    Effect.flatMap(decodeDocument),
    Effect.map((document) => document.sites),
    Effect.catch((cause) =>
      cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
        ? Effect.succeed([])
        : Effect.logWarning("Could not read browser notification permissions.", cause).pipe(
            Effect.as([]),
          ),
    ),
  );
  const decisions = new Map(initial.map((site) => [site.origin, site.decision] as const));

  const list = Effect.sync(() =>
    [...decisions]
      .map(([origin, decision]) => ({ origin, decision }))
      .toSorted((left, right) => left.origin.localeCompare(right.origin)),
  );
  const writeLock = yield* Semaphore.make(1);
  // A failed write keeps the in-memory answer for this run rather than prompting again.
  const persist = list.pipe(
    Effect.flatMap((sites) => encodeDocument({ sites })),
    Effect.flatMap((encoded) =>
      Effect.gen(function* () {
        const tempPath = `${storePath}.${process.pid}.tmp`;
        yield* fileSystem.makeDirectory(path.dirname(storePath), { recursive: true });
        yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
        yield* fileSystem.rename(tempPath, storePath);
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Could not save browser notification permissions.", cause),
    ),
    // Writers share one temp file, so they take turns.
    writeLock.withPermits(1),
  );

  return BrowserNotificationPermissions.of({
    decisionFor: (origin) => decisions.get(origin),
    set: Effect.fn("BrowserNotificationPermissions.set")(function* (origin, decision) {
      decisions.set(origin, decision);
      yield* persist;
    }),
    remove: Effect.fn("BrowserNotificationPermissions.remove")(function* (origin) {
      decisions.delete(origin);
      yield* persist;
      return yield* list;
    }),
    list,
  });
});

const BROWSER_NOTIFICATION_PERMISSIONS_FILE_NAME = "browser-notification-permissions.json";

export const layer = Layer.effect(
  BrowserNotificationPermissions,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return yield* makeAt(
      environment.path.join(environment.stateDir, BROWSER_NOTIFICATION_PERMISSIONS_FILE_NAME),
    );
  }),
);
