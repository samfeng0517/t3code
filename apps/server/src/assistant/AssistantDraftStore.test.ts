import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { AssistantDraft } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as AssistantDraftStore from "./AssistantDraftStore.ts";

const layerTest = () =>
  AssistantDraftStore.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-assistant-drafts-" })),
    ),
  );

const draft = (reportDate: string, overrides: Partial<AssistantDraft> = {}): AssistantDraft => ({
  reportDate,
  status: "ready",
  items: [],
  problemText: "",
  revision: 0,
  version: 1,
  sources: [],
  editedByUser: false,
  triggerAttempt: 0,
  updatedAt: "2026-11-05T00:00:00.000Z",
  ...overrides,
});

const draftsPath = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  return path.join(config.stateDir, "assistant-drafts.json");
});

it.layer(NodeServices.layer)("AssistantDraftStore", (it) => {
  it.effect(
    "AssistantDraftStore should return an empty file when assistant-drafts.json is missing",
    () =>
      Effect.gen(function* () {
        const store = yield* AssistantDraftStore.AssistantDraftStore;
        assert.deepEqual(yield* store.read(), { version: 1, workday: null, drafts: {} });
      }).pipe(Effect.provide(layerTest())),
  );

  it.effect("AssistantDraftStore should bump revision when update changes a draft", () =>
    Effect.gen(function* () {
      const store = yield* AssistantDraftStore.AssistantDraftStore;
      yield* store.update((file) => [
        undefined,
        { ...file, workday: "2026-11-05", drafts: { "2026-11-05": draft("2026-11-05") } },
      ]);
      const first = (yield* store.read()).drafts["2026-11-05"];
      assert.equal(first?.revision, 1);

      // A draft the callback leaves untouched keeps its revision.
      yield* store.update((file) => [undefined, { ...file }]);
      assert.equal((yield* store.read()).drafts["2026-11-05"]?.revision, 1);

      const result = yield* store.update((file) => [
        "done",
        {
          ...file,
          drafts: { "2026-11-05": { ...file.drafts["2026-11-05"]!, problemText: "blocked" } },
        },
      ]);
      assert.equal(result, "done");
      const second = (yield* store.read()).drafts["2026-11-05"];
      assert.equal(second?.revision, 2);
      assert.equal(second?.problemText, "blocked");
      assert.notEqual(second?.updatedAt, "2026-11-05T00:00:00.000Z");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("AssistantDraftStore should drop drafts older than 14 days when writing", () =>
    Effect.gen(function* () {
      const store = yield* AssistantDraftStore.AssistantDraftStore;
      yield* store.update((file) => [
        undefined,
        {
          ...file,
          drafts: {
            "2026-10-21": draft("2026-10-21"),
            "2026-10-22": draft("2026-10-22"),
            "2026-11-05": draft("2026-11-05"),
            // An impossible date is dropped without taking the valid drafts with it.
            "2026-13-01": draft("2026-13-01"),
          },
        },
      ]);
      assert.deepEqual(Object.keys((yield* store.read()).drafts).toSorted(), [
        "2026-10-22",
        "2026-11-05",
      ]);
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect(
    "AssistantDraftStore should move a corrupt file aside and start empty when decoding fails",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const filePath = yield* draftsPath;
        yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
        yield* fs.writeFileString(filePath, "{ not json");
        const store = yield* AssistantDraftStore.AssistantDraftStore;
        assert.deepEqual(yield* store.read(), { version: 1, workday: null, drafts: {} });
        assert.isFalse(yield* fs.exists(filePath));
        const aside = (yield* fs.readDirectory(path.dirname(filePath))).filter((name) =>
          name.startsWith("assistant-drafts.json.corrupt-"),
        );
        assert.lengthOf(aside, 1);
      }).pipe(Effect.provide(layerTest())),
  );
});
