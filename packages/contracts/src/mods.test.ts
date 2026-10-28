import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  applyModSurfaceEvent,
  EMPTY_MOD_SURFACE_STATE,
  MOD_UI_VALUE_MAX_LENGTH,
  ModSurfaceActInput,
  ModSurfaceFrame,
} from "./mods.ts";

const decodeFrame = Schema.decodeUnknownEffect(ModSurfaceFrame);
const decodeActInput = Schema.decodeUnknownEffect(ModSurfaceActInput);

it.effect("decodes a nested drawing in a pane frame", () =>
  Effect.gen(function* () {
    const frame = yield* decodeFrame({
      type: "pane-tree",
      paneId: "demo-pane",
      tree: {
        type: "box",
        direction: "column",
        children: [
          {
            type: "text",
            bold: true,
            children: ["Count ", { type: "text", tone: "muted", children: ["0"] }],
          },
          { type: "button", key: "inc", label: "Add one", plugin: "demo", handle: 7 },
        ],
      },
    });
    assert.strictEqual(frame.type, "pane-tree");
  }),
);

it.effect("rejects a pane id the provider could not have opened", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decodeActInput({
        threadId: "thread-1",
        action: { type: "close-pane", paneId: "../escape" },
      }),
    );
    assert.isTrue(Exit.isFailure(exit));
  }),
);

it("keeps a pane's drawing across roster changes and drops it with the pane", () => {
  const drawn = [
    { type: "reset", availability: "available" },
    {
      type: "panes",
      panes: [
        { id: "a", title: "A", plugin: "demo" },
        { id: "b", title: "B", plugin: "demo" },
      ],
    },
    { type: "pane-tree", paneId: "a", tree: { type: "markdown", text: "hi" } },
    { type: "pane-tree", paneId: "gone", tree: { type: "markdown", text: "never shown" } },
    { type: "panes", panes: [{ id: "a", title: "A again", plugin: "demo" }] },
    { type: "status", plugin: "demo", text: "ready" },
    { type: "status", plugin: "other", text: "busy" },
    { type: "status", plugin: "demo", text: null },
  ] as const;
  const state = drawn.reduce(applyModSurfaceEvent, EMPTY_MOD_SURFACE_STATE);
  assert.deepStrictEqual(state, {
    availability: "available",
    panes: [{ id: "a", title: "A again", plugin: "demo", tree: { type: "markdown", text: "hi" } }],
    band: null,
    statuses: [{ plugin: "other", text: "busy" }],
  });
  assert.deepStrictEqual(
    applyModSurfaceEvent(state, { type: "reset", availability: "inactive" }),
    EMPTY_MOD_SURFACE_STATE,
  );
});

it.effect("decodes fields, pickers and vector images in a drawing", () =>
  Effect.gen(function* () {
    const frame = yield* decodeFrame({
      type: "band",
      tree: {
        type: "box",
        direction: "column",
        children: [
          {
            type: "input",
            key: "note",
            plugin: "notes",
            handle: 3,
            value: "draft",
            placeholder: "Write a note",
            rows: 3,
          },
          {
            type: "select",
            key: "env",
            plugin: "notes",
            handle: 4,
            options: [{ value: "dev", label: "Development" }, { value: "prod" }],
            value: "dev",
          },
          { type: "svg", source: "<svg/>", alt: "logo", width: 32, height: 32 },
        ],
      },
    });
    assert.strictEqual(frame.type, "band");
  }),
);

it.effect("carries a control's autofocus and an interactive vector image, and only as true", () =>
  Effect.gen(function* () {
    const tree = {
      type: "box",
      direction: "column",
      children: [
        { type: "input", key: "q", plugin: "p", handle: 1, value: "", autoFocus: true },
        {
          type: "select",
          key: "s",
          plugin: "p",
          handle: 2,
          options: [{ value: "a" }],
          autoFocus: true,
        },
        { type: "button", key: "b", label: "Go", plugin: "p", handle: 3, autoFocus: true },
        { type: "svg", source: "<svg/>", alt: "chart", interactive: true },
      ],
    } as const;
    const frame = yield* decodeFrame({ type: "band", tree });
    assert.deepStrictEqual(frame, { type: "band", tree });

    const falseFlag = yield* Effect.exit(
      decodeFrame({
        type: "band",
        tree: { type: "svg", source: "<svg/>", alt: "chart", interactive: false },
      }),
    );
    assert.isTrue(Exit.isFailure(falseFlag));
  }),
);

it.effect(
  "carries a field's text and a pick back to the mod, bounded as Claude Code bounds them",
  () =>
    Effect.gen(function* () {
      const site = { component: "Pane", paneId: "demo-pane" };
      const input = yield* decodeActInput({
        threadId: "thread-1",
        action: {
          type: "input",
          site,
          plugin: "notes",
          handle: 3,
          key: "note",
          kind: "submit",
          value: "line one\nline two",
        },
      });
      assert.strictEqual(input.action.type, "input");
      const pick = yield* decodeActInput({
        threadId: "thread-1",
        action: { type: "select", site, plugin: "notes", handle: 4, key: "env", value: "prod" },
      });
      assert.strictEqual(pick.action.type, "select");

      const tooLong = yield* Effect.exit(
        decodeActInput({
          threadId: "thread-1",
          action: {
            type: "input",
            site,
            plugin: "notes",
            handle: 3,
            key: "note",
            kind: "change",
            value: "x".repeat(MOD_UI_VALUE_MAX_LENGTH + 1),
          },
        }),
      );
      assert.isTrue(Exit.isFailure(tooLong));
      const unknownKind = yield* Effect.exit(
        decodeActInput({
          threadId: "thread-1",
          action: {
            type: "input",
            site,
            plugin: "notes",
            handle: 3,
            key: "note",
            kind: "blur",
            value: "",
          },
        }),
      );
      assert.isTrue(Exit.isFailure(unknownKind));
    }),
);
