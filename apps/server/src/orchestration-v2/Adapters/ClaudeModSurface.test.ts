import type { ModSurfaceEvent } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";

import {
  ClaudeModRequestError,
  claudeQueryUiRequester,
  isClaudeUiPush,
  makeClaudeModSurface,
  translateClaudeUiTree,
  type ClaudeUiControlRequest,
} from "./ClaudeModSurface.ts";

// What Claude Code 2.1.306 answered a desktop `ui_render` of a mod's pane.
const PANE_TREE = {
  type: "Box",
  props: { flexDirection: "column" },
  children: [
    { type: "Text", props: { bold: true, weight: "semibold" }, children: ["Count ", "0"] },
    { type: "Markdown", props: { text: "**hi** there" } },
    {
      type: "Button",
      props: { key: "inc", label: "Increment" },
      press: { plugin: "demo", handle: 90342201 },
    },
  ],
  part: { plugin: "demo" },
};

const ROSTER = [{ id: "demo-pane", title: "Demo pane", plugin: "demo" }];

const TOAST_PUSH = {
  type: "system",
  subtype: "ui_toast",
  plugin: "demo",
  text: "hello from demo",
  timeout_ms: 4000,
  uuid: "4975a883-631a-4ab1-a935-17310cd889aa",
  session_id: "s",
};

function makeHarness(answers: {
  /** "refuse" answers as a CLI without mods; a Deferred holds the answer until it completes. */
  readonly attach?: "refuse" | Deferred.Deferred<void>;
  readonly pressHandled?: boolean;
}) {
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<ModSurfaceEvent>();
    const requests: Array<ClaudeUiControlRequest> = [];
    const surface = makeClaudeModSurface({
      scope: yield* Effect.scope,
      emit: (event) => Queue.offer(events, event).pipe(Effect.asVoid),
      request: (request) => {
        requests.push(request);
        switch (request.subtype) {
          case "ui_attach":
            if (answers.attach === "refuse") {
              return Effect.fail(
                new ClaudeModRequestError({
                  subtype: request.subtype,
                  cause: "Unsupported control request subtype: ui_attach",
                }),
              );
            }
            return (
              answers.attach === undefined ? Effect.void : Deferred.await(answers.attach)
            ).pipe(Effect.as({ surfaces: ["desktop"] }));
          case "ui_panes":
            return Effect.succeed({ panes: ROSTER, shown_id: "demo-pane", focused_id: null });
          case "ui_render":
            return Effect.succeed(
              request.component === "Pane"
                ? { tree: PANE_TREE, props: {}, rewritten: false, hooked: true }
                : { tree: { type: "engine", ref: 0 }, props: {}, rewritten: false, hooked: false },
            );
          case "ui_press":
            return Effect.succeed({ handled: answers.pressHandled ?? true, element: "inc" });
          case "ui_input":
          case "ui_select":
            return Effect.succeed({
              handled: answers.pressHandled ?? true,
              element: request.key,
              value: request.value,
            });
          case "ui_close":
            return Effect.succeed({ closed: true });
          default:
            return Effect.void;
        }
      },
    });
    return { surface, events, requests };
  });
}

describe("translateClaudeUiTree", () => {
  it("turns a mod's pane drawing into client nodes", () => {
    assert.deepStrictEqual(translateClaudeUiTree(PANE_TREE), {
      type: "box",
      direction: "column",
      children: [
        { type: "text", bold: true, children: ["Count ", "0"] },
        { type: "markdown", text: "**hi** there" },
        { type: "button", key: "inc", label: "Increment", plugin: "demo", handle: 90342201 },
      ],
    });
  });

  it("keeps styled runs and links inline, and marks elements it cannot draw", () => {
    assert.deepStrictEqual(
      translateClaudeUiTree({
        type: "Box",
        children: [
          {
            type: "Text",
            props: { color: "red" },
            children: [
              "failed: ",
              { type: "Text", props: { dimColor: true }, children: ["see "] },
              { type: "Link", props: { href: "https://example.com/run/1" }, children: ["run"] },
            ],
          },
          {
            type: "Client",
            props: { key: "board", module: "hooks/board.tsx" },
            client: { plugin: "notes" },
          },
          { type: "engine", ref: 1 },
        ],
      }),
      {
        type: "box",
        direction: "row",
        children: [
          {
            type: "text",
            tone: "error",
            children: [
              "failed: ",
              { type: "text", tone: "muted", children: ["see "] },
              { type: "link", href: "https://example.com/run/1", label: "run" },
            ],
          },
          { type: "unsupported", element: "Client" },
        ],
      },
    );
  });

  it("draws fields, pickers and vector images with the handlers they carry", () => {
    assert.deepStrictEqual(
      translateClaudeUiTree({
        type: "Box",
        props: { flexDirection: "column" },
        children: [
          {
            type: "Input",
            props: {
              key: "note",
              label: "Note",
              placeholder: "Write a note",
              value: "draft",
              submitLabel: "Save",
              rows: 500,
            },
            press: { plugin: "notes", handle: 3 },
          },
          {
            type: "Input",
            props: { key: "title", rows: 1 },
            press: { plugin: "notes", handle: 4 },
          },
          {
            type: "Select",
            props: {
              key: "env",
              label: "Environment",
              options: [
                { value: "dev", label: "Development" },
                { value: "prod" },
                { value: "dev", label: "Duplicate" },
                { label: "No value" },
              ],
              value: "prod",
            },
            press: { plugin: "notes", handle: 5 },
          },
          {
            type: "Svg",
            props: {
              source: "<svg/>",
              alt: "logo",
              width: 32,
              height: 99_999,
              isInteractive: true,
            },
          },
        ],
      }),
      {
        type: "box",
        direction: "column",
        children: [
          {
            type: "input",
            key: "note",
            plugin: "notes",
            handle: 3,
            value: "draft",
            label: "Note",
            placeholder: "Write a note",
            submitLabel: "Save",
            rows: 20,
          },
          { type: "input", key: "title", plugin: "notes", handle: 4, value: "" },
          {
            type: "select",
            key: "env",
            plugin: "notes",
            handle: 5,
            options: [{ value: "dev", label: "Development" }, { value: "prod" }],
            value: "prod",
            label: "Environment",
          },
          {
            type: "svg",
            source: "<svg/>",
            alt: "logo",
            width: 32,
            height: 4096,
            interactive: true,
          },
        ],
      },
    );
  });

  it("carries autofocus on controls and interactivity on images only when set to true", () => {
    const press = { plugin: "notes", handle: 1 };
    const translate = (children: ReadonlyArray<unknown>) =>
      translateClaudeUiTree({ type: "Box", props: { flexDirection: "column" }, children });
    assert.deepStrictEqual(
      translate([
        { type: "Input", props: { key: "q", autoFocus: true }, press },
        { type: "Select", props: { key: "s", options: [{ value: "a" }], autoFocus: true }, press },
        { type: "Button", props: { key: "b", label: "Go", autoFocus: true }, press },
      ]),
      {
        type: "box",
        direction: "column",
        children: [
          { type: "input", key: "q", ...press, value: "", autoFocus: true },
          { type: "select", key: "s", ...press, options: [{ value: "a" }], autoFocus: true },
          { type: "button", key: "b", label: "Go", ...press, autoFocus: true },
        ],
      },
    );
    assert.deepStrictEqual(
      translate([
        { type: "Input", props: { key: "q", autoFocus: false }, press },
        { type: "Button", props: { key: "b", label: "Go", autoFocus: "yes" }, press },
        // Claude Code refuses autoFocus on an Svg; it never takes the focus.
        { type: "Svg", props: { source: "<svg/>", alt: "a", autoFocus: true } },
        { type: "Svg", props: { source: "<svg/>", alt: "b", isInteractive: false } },
      ]),
      {
        type: "box",
        direction: "column",
        children: [
          { type: "input", key: "q", ...press, value: "" },
          { type: "button", key: "b", label: "Go", ...press },
          { type: "svg", source: "<svg/>", alt: "a" },
          { type: "svg", source: "<svg/>", alt: "b" },
        ],
      },
    );
  });

  it("marks a field, picker or image it cannot act on or draw safely as unsupported", () => {
    const unsupported = (element: string) => ({ type: "unsupported", element }) as const;
    assert.deepStrictEqual(
      translateClaudeUiTree({ type: "Input", props: { key: "note" }, press: { plugin: "notes" } }),
      unsupported("Input"),
    );
    assert.deepStrictEqual(
      translateClaudeUiTree({
        type: "Select",
        props: { key: "env", options: [] },
        press: { plugin: "notes", handle: 5 },
      }),
      unsupported("Select"),
    );
    assert.deepStrictEqual(
      translateClaudeUiTree({ type: "Svg", props: { source: "x".repeat(131_073), alt: "big" } }),
      unsupported("Svg"),
    );
    assert.deepStrictEqual(
      translateClaudeUiTree({
        type: "Svg",
        props: { source: "<svg><text>\uD800</text></svg>", alt: "broken" },
      }),
      unsupported("Svg"),
    );
  });

  it("treats Claude Code's own drawing as nothing to show", () => {
    assert.isNull(translateClaudeUiTree({ type: "engine", ref: 0 }));
  });
});

describe("makeClaudeModSurface", () => {
  it.effect("attaches as a desktop surface and draws the open panes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events, requests } = yield* makeHarness({});
        yield* surface.attach;

        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "available",
        });
        assert.deepStrictEqual(yield* Queue.take(events), { type: "panes", panes: ROSTER });
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "pane-tree",
          paneId: "demo-pane",
          tree: translateClaudeUiTree(PANE_TREE),
        });
        // No mod hooks the band, so it stays empty.
        assert.deepStrictEqual(yield* Queue.take(events), { type: "band", tree: null });
        assert.deepStrictEqual(
          requests.map((request) => [request.subtype, request.surface ?? null]),
          [
            ["ui_attach", "desktop"],
            ["ui_panes", null],
            ["ui_render", "desktop"],
            ["ui_render", "desktop"],
          ],
        );
      }),
    ),
  );

  it.effect("relays toasts and status lines, and redraws on invalidate", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events, requests } = yield* makeHarness({});
        yield* surface.attach;
        yield* Queue.take(events);
        assert.strictEqual((yield* Queue.take(events)).type, "panes");
        assert.strictEqual((yield* Queue.take(events)).type, "pane-tree");
        assert.strictEqual((yield* Queue.take(events)).type, "band");
        requests.length = 0;
        assert.isTrue(yield* surface.handleMessage(TOAST_PUSH));
        assert.isTrue(
          yield* surface.handleMessage({
            type: "system",
            subtype: "ui_status",
            plugin: "demo",
            text: null,
            uuid: "u",
            session_id: "s",
          }),
        );
        assert.isTrue(
          yield* surface.handleMessage({
            type: "system",
            subtype: "ui_panes",
            panes: ROSTER,
            shown_id: "demo-pane",
            focused_id: null,
            focus_requested_id: null,
          }),
        );
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "toast",
          toast: {
            id: "4975a883-631a-4ab1-a935-17310cd889aa",
            plugin: "demo",
            text: "hello from demo",
            timeoutMs: 4000,
          },
        });
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "status",
          plugin: "demo",
          text: null,
        });
        // The roster is unchanged, so the open pane is not drawn again.
        assert.deepStrictEqual(yield* Queue.take(events), { type: "panes", panes: ROSTER });

        yield* surface.handleMessage({
          type: "system",
          subtype: "ui_invalidate",
          event: "ui.render",
          instances: [{ surface: "desktop", component: "Pane", instance_id: "demo-pane" }],
        });
        assert.strictEqual((yield* Queue.take(events)).type, "pane-tree");
        assert.strictEqual(requests.filter((request) => request.subtype === "ui_render").length, 1);
        assert.isFalse(yield* surface.handleMessage({ type: "system", subtype: "init" }));
        assert.isFalse(isClaudeUiPush({ type: "assistant", subtype: "ui_toast" }));
      }),
    ),
  );

  it.effect("sends a press back by its handle, and redraws a stale drawing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events, requests } = yield* makeHarness({ pressHandled: false });
        yield* surface.attach;
        for (let index = 0; index < 4; index++) yield* Queue.take(events);

        const result = yield* surface.act({
          type: "press",
          site: { component: "Pane", paneId: "demo-pane" },
          plugin: "demo",
          handle: 90342201,
          key: "inc",
        });
        assert.deepStrictEqual(result, { handled: false });
        assert.deepStrictEqual(
          requests.find((request) => request.subtype === "ui_press"),
          {
            subtype: "ui_press",
            plugin: "demo",
            handle: 90342201,
            key: "inc",
            surface: "desktop",
            client_id: "t3code",
          },
        );
        assert.strictEqual((yield* Queue.take(events)).type, "pane-tree");

        assert.deepStrictEqual(yield* surface.act({ type: "close-pane", paneId: "demo-pane" }), {
          handled: true,
        });
        assert.deepStrictEqual(requests.at(-1), {
          subtype: "ui_close",
          id: "demo-pane",
          client_id: "t3code",
        });
      }),
    ),
  );

  it.effect(
    "sends edits and picks with where they were drawn, so Claude Code can re-resolve them",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { surface, events, requests } = yield* makeHarness({});
          yield* surface.attach;
          for (let index = 0; index < 4; index++) yield* Queue.take(events);
          requests.length = 0;

          assert.deepStrictEqual(
            yield* surface.act({
              type: "input",
              site: { component: "AbovePrompt" },
              plugin: "notes",
              handle: 3,
              key: "note",
              kind: "submit",
              value: "line one\nline two",
            }),
            { handled: true },
          );
          assert.deepStrictEqual(
            yield* surface.act({
              type: "select",
              site: { component: "Pane", paneId: "demo-pane" },
              plugin: "notes",
              handle: 5,
              key: "env",
              value: "prod",
            }),
            { handled: true },
          );
          assert.deepStrictEqual(requests, [
            {
              subtype: "ui_input",
              plugin: "notes",
              handle: 3,
              key: "note",
              surface: "desktop",
              client_id: "t3code",
              component: "AbovePrompt",
              instance_id: "above-prompt",
              kind: "submit",
              value: "line one\nline two",
            },
            {
              subtype: "ui_select",
              plugin: "notes",
              handle: 5,
              key: "env",
              surface: "desktop",
              client_id: "t3code",
              component: "Pane",
              instance_id: "demo-pane",
              value: "prod",
            },
          ]);
          // A handled edit leaves redrawing to Claude Code's own invalidate.
          assert.strictEqual(yield* Queue.size(events), 0);
        }),
      ),
  );

  it.effect("redraws a stale field after an edit nothing handled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events, requests } = yield* makeHarness({ pressHandled: false });
        yield* surface.attach;
        for (let index = 0; index < 4; index++) yield* Queue.take(events);
        requests.length = 0;

        assert.deepStrictEqual(
          yield* surface.act({
            type: "input",
            site: { component: "Pane", paneId: "demo-pane" },
            plugin: "notes",
            handle: 3,
            key: "note",
            kind: "change",
            value: "dra",
          }),
          { handled: false },
        );
        assert.strictEqual((yield* Queue.take(events)).type, "pane-tree");
        assert.deepStrictEqual(
          requests.map((request) => request.subtype),
          ["ui_input", "ui_render"],
        );
      }),
    ),
  );

  it.effect("reports a CLI without the mods protocol as unsupported", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events } = yield* makeHarness({ attach: "refuse" });
        yield* surface.attach;
        // Never "available" first: the panel would flash "no panes open" before it.
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "unsupported",
        });
        assert.deepStrictEqual(yield* surface.act({ type: "close-pane", paneId: "demo-pane" }), {
          handled: false,
        });
        yield* surface.detach;
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "unsupported",
        });
      }),
    ),
  );

  it.effect("reports an SDK that cannot send control requests as unsupported", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<ModSurfaceEvent>();
        const surface = makeClaudeModSurface({
          scope: yield* Effect.scope,
          emit: (event) => Queue.offer(events, event).pipe(Effect.asVoid),
          request: undefined,
        });
        yield* surface.attach;
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "unsupported",
        });
      }),
    ),
  );
  it.effect("holds pushes that arrive before Claude Code accepts the attach", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attachAnswered = yield* Deferred.make<void>();
        const { surface, events } = yield* makeHarness({ attach: attachAnswered });
        yield* surface.attach;
        assert.isTrue(
          yield* surface.handleMessage({
            type: "system",
            subtype: "ui_status",
            plugin: "demo",
            text: "ready",
          }),
        );
        assert.strictEqual(yield* Queue.size(events), 0);

        yield* Deferred.succeed(attachAnswered, undefined);
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "available",
        });
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "status",
          plugin: "demo",
          text: "ready",
        });
        assert.deepStrictEqual(yield* Queue.take(events), { type: "panes", panes: ROSTER });
      }),
    ),
  );

  it.effect("says once that the process ended, then stays quiet", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events } = yield* makeHarness({});
        yield* surface.attach;
        for (let index = 0; index < 4; index++) yield* Queue.take(events);

        yield* surface.detach;
        assert.deepStrictEqual(yield* Queue.take(events), {
          type: "reset",
          availability: "inactive",
        });
        yield* surface.detach;
        assert.isTrue(yield* surface.handleMessage(TOAST_PUSH));
        assert.deepStrictEqual(
          yield* surface.act({
            type: "press",
            site: { component: "Pane", paneId: "demo-pane" },
            plugin: "demo",
            handle: 90342201,
            key: "inc",
          }),
          { handled: false },
        );
        assert.strictEqual(yield* Queue.size(events), 0);
      }),
    ),
  );

  it.effect("a released surface never resets the thread a newer process took over", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { surface, events } = yield* makeHarness({});
        yield* surface.attach;
        for (let index = 0; index < 4; index++) yield* Queue.take(events);

        yield* surface.release;
        assert.isTrue(yield* surface.handleMessage(TOAST_PUSH));
        yield* surface.detach;
        assert.strictEqual(yield* Queue.size(events), 0);
      }),
    ),
  );
});

describe("claudeQueryUiRequester", () => {
  it("passes the abort signal so Claude Code can cancel the request", async () => {
    const seen: Array<unknown> = [];
    const queryRuntime = {
      request: (request: unknown, options: unknown) => {
        seen.push(request, options);
        return Promise.resolve({ response: { handled: true } });
      },
    };
    const send = claudeQueryUiRequester(queryRuntime);
    const controller = new AbortController();
    assert.deepStrictEqual(await send?.({ subtype: "ui_press" }, controller.signal), {
      handled: true,
    });
    assert.deepStrictEqual(seen, [{ subtype: "ui_press" }, { signal: controller.signal }]);
    assert.isUndefined(claudeQueryUiRequester({}));
  });
});
