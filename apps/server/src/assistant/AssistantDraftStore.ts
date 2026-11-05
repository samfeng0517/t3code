import { AssistantDraft, AssistantReportDate } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

export class AssistantDraftStoreError extends Schema.TaggedError<AssistantDraftStoreError>()(
  "AssistantDraftStoreError",
  {
    operation: Schema.Literals(["read", "write"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} the assistant drafts file.`;
  }
}

export const AssistantDraftFile = Schema.Struct({
  version: Schema.Literal(1),
  /** The ERP workday the daily draft was last triggered for. */
  workday: Schema.NullOr(AssistantReportDate),
  drafts: Schema.Record(AssistantReportDate, AssistantDraft),
});
export type AssistantDraftFile = typeof AssistantDraftFile.Type;

const EMPTY_FILE: AssistantDraftFile = { version: 1, workday: null, drafts: {} };
const KEEP_DAYS = 14;
const FILE_NAME = "assistant-drafts.json";

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AssistantDraftFile));
const encodeFile = Schema.encodeEffect(Schema.fromJsonString(AssistantDraftFile));

const dayNumber = (reportDate: string) => Date.parse(`${reportDate}T00:00:00Z`) / 86_400_000;

/** Keeps the drafts within 14 days of the newest report date in the file. */
const prune = (file: AssistantDraftFile): AssistantDraftFile => {
  // An impossible date such as 2026-13-01 parses to NaN; it must not make every draft look stale.
  const days = Object.keys(file.drafts).map(dayNumber).filter(Number.isFinite);
  if (days.length === 0) return file;
  const newest = Math.max(...days);
  return {
    ...file,
    drafts: Object.fromEntries(
      Object.entries(file.drafts).filter(([date]) => newest - dayNumber(date) <= KEEP_DAYS),
    ),
  };
};

export class AssistantDraftStore extends Context.Service<
  AssistantDraftStore,
  {
    readonly read: () => Effect.Effect<AssistantDraftFile, AssistantDraftStoreError>;
    /**
     * Applies `f` under a lock and writes the result. Drafts `f` replaced get a bumped revision
     * and a fresh `updatedAt`, so `f` should replace only the drafts it changes; callers bump
     * `version` themselves.
     */
    readonly update: <A>(
      f: (file: AssistantDraftFile) => readonly [A, AssistantDraftFile],
    ) => Effect.Effect<A, AssistantDraftStoreError>;
    /** Emits the file after every successful write. */
    readonly changes: Stream.Stream<AssistantDraftFile>;
  }
>()("t3/assistant/AssistantDraftStore") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(config.stateDir, FILE_NAME);
  const lock = yield* Semaphore.make(1);
  const pubsub = yield* PubSub.unbounded<AssistantDraftFile>();
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const readUnlocked = Effect.fn("AssistantDraftStore.readFile")(
    function* () {
      const exists = yield* fs.exists(filePath);
      if (!exists) return EMPTY_FILE;
      const raw = yield* fs.readFileString(filePath);
      return yield* decodeFile(raw).pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const aside = `${filePath}.corrupt-${now}`;
            yield* Effect.logWarning("Assistant drafts file is unreadable; starting empty").pipe(
              Effect.annotateLogs({ movedTo: path.basename(aside), reason: cause._tag }),
            );
            yield* fs.rename(filePath, aside);
            return EMPTY_FILE;
          }),
        ),
      );
    },
    Effect.mapError((cause) => new AssistantDraftStoreError({ operation: "read", cause })),
  );

  const read = Effect.fn("AssistantDraftStore.read")(function* () {
    return yield* readUnlocked();
  }, lock.withPermits(1));

  const update = Effect.fn("AssistantDraftStore.update")(function* <A>(
    f: (file: AssistantDraftFile) => readonly [A, AssistantDraftFile],
  ): Effect.fn.Return<A, AssistantDraftStoreError> {
    const current = yield* readUnlocked();
    const [result, proposed] = f(current);
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    const drafts = Object.fromEntries(
      Object.entries(proposed.drafts).map(([date, draft]) => {
        const previous = current.drafts[date];
        if (previous === draft) return [date, draft];
        return [
          date,
          { ...draft, revision: (previous?.revision ?? draft.revision) + 1, updatedAt },
        ];
      }),
    );
    const next = prune({ ...proposed, drafts });
    const contents = yield* encodeFile(next).pipe(
      Effect.mapError((cause) => new AssistantDraftStoreError({ operation: "write", cause })),
    );
    yield* writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provide(context),
      Effect.mapError((cause) => new AssistantDraftStoreError({ operation: "write", cause })),
    );
    yield* PubSub.publish(pubsub, next);
    return result;
  }, lock.withPermits(1));

  return AssistantDraftStore.of({
    read,
    update,
    changes: Stream.fromPubSub(pubsub),
  });
});

export const layer = Layer.effect(AssistantDraftStore, make);
