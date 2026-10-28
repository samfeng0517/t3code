import type {
  ModPaneSummary,
  ModSurfaceAction,
  ModSurfaceActResult,
  ModSurfaceEvent,
  ModSurfaceSite,
  ModUiLink,
  ModUiNode,
  ModUiSelectOption,
  ModUiText,
  ModUiTone,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

/**
 * Claude Code mods (plugins with a hooks module) draw panes, a band, status lines and toasts. A headless
 * session draws them for a remote surface over the stream-json control channel, as Claude Code Desktop does
 * (`ui_attach`, `system/ui_*`, `ui_render`, `ui_invalidate`, `ui_press|input|select`). These requests are
 * internal to Claude Code (verified against 2.1.306; Input, Select, Svg 2.1.308); a CLI lacking them refuses `ui_attach`.
 */

/** One client of this T3 server; every viewer shares the process's single drawing. */
const CLIENT_ID = "t3code";
/** T3 Code's chat view docks panes beside the transcript, as Claude Code Desktop does. */
const SURFACE = "desktop";
// The panel is measured in pixels, not cells; these are what a docked desktop pane reports.
const PANE_COLUMNS = 56;
const PANE_ROWS = 40;
const BAND_COLUMNS = 80;
const BAND_ROWS = 6;
const VIEWPORT = { columns: PANE_COLUMNS + 4, rows: PANE_ROWS, isFullscreen: true } as const;
const MAX_TREE_DEPTH = 64;
const BAND_INSTANCE_ID = "above-prompt";
// Claude Code bounds an Svg's source to 128 KiB and its size to 4096 px before
// the tree crosses; held again here so a client never draws past them.
const MAX_SVG_SOURCE_LENGTH = 131_072;
const MAX_SVG_SIZE = 4096;
// A field of many rows is drawn this tall at most; the rest scrolls.
const MAX_INPUT_ROWS = 20;

export interface ClaudeUiControlRequest {
  readonly subtype: string;
  readonly [field: string]: unknown;
}

export class ClaudeModRequestError extends Schema.TaggedError<ClaudeModRequestError>()(
  "ClaudeModRequestError",
  { subtype: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Claude Code refused the ${this.subtype} request.`;
  }
}

/** Resolves the control response's `response` payload; fails when the CLI refuses the request. */
export type ClaudeUiRequest = (
  request: ClaudeUiControlRequest,
) => Effect.Effect<unknown, ClaudeModRequestError>;

/**
 * The Agent SDK's Query sends any control request through `request`, which its
 * typings leave out; the typed methods (stopTask, setModel) are built on it.
 * Aborting `signal` cancels the request in Claude Code too, so a mod handler
 * that never answers does not keep a pending request forever.
 */
export function claudeQueryUiRequester(
  queryRuntime: object,
): ((request: ClaudeUiControlRequest, signal: AbortSignal) => Promise<unknown>) | undefined {
  if (!("request" in queryRuntime) || !Predicate.isFunction(queryRuntime.request)) {
    return undefined;
  }
  const request = queryRuntime.request;
  return async (input, signal) => {
    const answer: unknown = await request.call(queryRuntime, input, { signal });
    return Predicate.isObject(answer) && "response" in answer ? answer.response : undefined;
  };
}

const UiPanesPush = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("ui_panes"),
  panes: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String, plugin: Schema.String }),
  ),
});
const UiInvalidatePush = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("ui_invalidate"),
  instances: Schema.optional(
    Schema.Array(
      Schema.Struct({
        surface: Schema.String,
        component: Schema.String,
        instance_id: Schema.String,
      }),
    ),
  ),
});
const UiToastPush = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("ui_toast"),
  plugin: Schema.String,
  text: Schema.String,
  timeout_ms: Schema.optional(Schema.Number),
  uuid: Schema.String,
});
const UiStatusPush = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("ui_status"),
  plugin: Schema.String,
  text: Schema.NullOr(Schema.String),
});
const UiLogPush = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("ui_log"),
  plugin: Schema.String,
  text: Schema.String,
});
const ClaudeUiPush = Schema.Union([
  UiPanesPush,
  UiInvalidatePush,
  UiToastPush,
  UiStatusPush,
  UiLogPush,
]);
const decodeClaudeUiPush = Schema.decodeUnknownOption(ClaudeUiPush);
const isPaneId = Schema.is(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)));

const RenderAnswer = Schema.Struct({ tree: Schema.Unknown, hooked: Schema.Boolean });
const decodeRenderAnswer = Schema.decodeUnknownOption(RenderAnswer);
const decodeRosterAnswer = Schema.decodeUnknownOption(
  Schema.Struct({ panes: UiPanesPush.fields.panes }),
);
const decodeHandled = Schema.decodeUnknownOption(Schema.Struct({ handled: Schema.Boolean }));
const decodeClosed = Schema.decodeUnknownOption(Schema.Struct({ closed: Schema.Boolean }));

/** True for the `system/ui_*` pushes this surface consumes; they are never transcript frames. */
export function isClaudeUiPush(message: unknown): boolean {
  if (!Predicate.isObject(message) || message.type !== "system") return false;
  const subtype = "subtype" in message ? message.subtype : undefined;
  return typeof subtype === "string" && subtype.startsWith("ui_");
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return Predicate.isObject(value) ? (value as Readonly<Record<string, unknown>>) : {};
}

function stringProp(props: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = props[name];
  return typeof value === "string" ? value : undefined;
}

function positiveNumberProp(
  props: Readonly<Record<string, unknown>>,
  name: string,
  max: number,
): number | undefined {
  const value = props[name];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, max)
    : undefined;
}

/** The handler a Button, Input or Select carries: what a press, edit or pick names. */
function pressOf(node: Readonly<Record<string, unknown>>) {
  const press = record(node.press);
  const plugin = stringProp(press, "plugin");
  const handle = press.handle;
  return plugin === undefined || typeof handle !== "number" || !Number.isSafeInteger(handle)
    ? undefined
    : { plugin, handle };
}

// Claude Code takes `autoFocus` on a Button, Input or Select only, and only as `true`.
const autoFocusOf = (props: Readonly<Record<string, unknown>>) =>
  props.autoFocus === true ? { autoFocus: true as const } : {};

function translateSelectOptions(options: unknown): Array<ModUiSelectOption> {
  const seen = new Set<string>();
  const translated: Array<ModUiSelectOption> = [];
  for (const option of Array.isArray(options) ? options : []) {
    const props = record(option);
    const value = stringProp(props, "value");
    // Claude Code refuses duplicate values; a pick names its option by value alone.
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    const label = stringProp(props, "label");
    translated.push(label === undefined ? { value } : { value, label });
  }
  return translated;
}

function toneOf(props: Readonly<Record<string, unknown>>): ModUiTone | undefined {
  const color = stringProp(props, "color")?.toLowerCase();
  switch (color) {
    case "red":
    case "error":
      return "error";
    case "green":
    case "success":
      return "success";
    case "yellow":
    case "warning":
      return "warning";
    case "blue":
    case "cyan":
    case "suggestion":
    case "claude":
    case "permission":
      return "info";
    case "gray":
    case "grey":
    case "inactive":
    case "subtle":
      return "muted";
  }
  return props.dimColor === true ? "muted" : undefined;
}

function plainText(children: unknown, depth: number): string {
  if (depth > MAX_TREE_DEPTH || !Array.isArray(children)) return "";
  return children
    .map((child) =>
      typeof child === "string"
        ? child
        : plainText(record(child).children, depth + 1) ||
          (stringProp(record(record(child).props), "label") ?? ""),
    )
    .join("");
}

function translateLink(props: Readonly<Record<string, unknown>>, children: unknown): ModUiLink {
  const href = stringProp(props, "href") ?? "";
  const label = stringProp(props, "label") ?? plainText(children, 0);
  return label.length > 0 ? { type: "link", href, label } : { type: "link", href };
}

function translateText(
  type: string,
  props: Readonly<Record<string, unknown>>,
  children: unknown,
  depth: number,
): ModUiText {
  const tone = toneOf(props);
  const inline: Array<string | ModUiText | ModUiLink> = [];
  for (const child of Array.isArray(children) ? children : []) {
    if (typeof child === "string") {
      inline.push(child);
      continue;
    }
    const node = translateClaudeUiTree(child, depth + 1);
    if (node === null) continue;
    if (node.type === "text" || node.type === "link") inline.push(node);
    else if (node.type === "button") inline.push(node.label);
  }
  return {
    type: "text",
    ...(tone === undefined ? {} : { tone }),
    ...(props.bold === true || type === "b" ? { bold: true as const } : {}),
    ...(props.italic === true ? { italic: true as const } : {}),
    ...(props.underline === true ? { underline: true as const } : {}),
    ...(props.strikethrough === true ? { strikethrough: true as const } : {}),
    children: inline,
  };
}

/**
 * Claude Code's remote-surface element tree as client nodes. `null` is Claude
 * Code's own drawing (`{ type: "engine" }`), which a pane or band does not have.
 */
export function translateClaudeUiTree(tree: unknown, depth = 0): ModUiNode | null {
  if (depth > MAX_TREE_DEPTH) return null;
  if (typeof tree === "string") return { type: "text", children: [tree] };
  const node = record(tree);
  const type = typeof node.type === "string" ? node.type : "";
  const props = record(node.props);
  switch (type) {
    case "engine":
    case "":
      return null;
    case "Box":
    case "div": {
      const children: Array<ModUiNode> = [];
      for (const child of Array.isArray(node.children) ? node.children : []) {
        const translated = translateClaudeUiTree(child, depth + 1);
        if (translated !== null) children.push(translated);
      }
      return {
        type: "box",
        direction:
          props.flexDirection === "column" || (type === "div" && props.flexDirection !== "row")
            ? "column"
            : "row",
        ...(typeof props.borderStyle === "string" ? { bordered: true as const } : {}),
        children,
      };
    }
    case "Text":
    case "span":
    case "b":
      return translateText(type, props, node.children, depth);
    case "Link":
      return translateLink(props, node.children);
    case "Button": {
      const press = pressOf(node);
      const key = stringProp(props, "key");
      if (key === undefined || press === undefined) {
        return { type: "unsupported", element: type };
      }
      const label = stringProp(props, "label") || plainText(node.children, depth + 1) || key;
      return {
        type: "button",
        key,
        label,
        ...press,
        ...(props.variant === "primary" ? { variant: "primary" as const } : {}),
        ...(props.role === "dismiss" ? { dismiss: true as const } : {}),
        ...autoFocusOf(props),
      };
    }
    case "Markdown":
      // `press`/`pressableLinks` are not forwarded in v1: the client opens a
      // Markdown link itself, so a mod never hears about the click.
      return { type: "markdown", text: stringProp(props, "text") ?? "" };
    case "Code": {
      const language = stringProp(props, "language");
      return {
        type: "code",
        source: stringProp(props, "source") ?? "",
        ...(language === undefined ? {} : { language }),
        ...(props.format === "diff" ? { diff: true as const } : {}),
      };
    }
    case "Input": {
      const press = pressOf(node);
      const key = stringProp(props, "key");
      if (key === undefined || press === undefined) {
        return { type: "unsupported", element: type };
      }
      const label = stringProp(props, "label");
      const placeholder = stringProp(props, "placeholder");
      const submitLabel = stringProp(props, "submitLabel");
      const rows =
        typeof props.rows === "number" && Number.isSafeInteger(props.rows) && props.rows > 1
          ? Math.min(props.rows, MAX_INPUT_ROWS)
          : undefined;
      return {
        type: "input",
        key,
        ...press,
        value: stringProp(props, "value") ?? "",
        ...(label === undefined ? {} : { label }),
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(submitLabel === undefined ? {} : { submitLabel }),
        ...(rows === undefined ? {} : { rows }),
        ...autoFocusOf(props),
      };
    }
    case "Select": {
      const press = pressOf(node);
      const key = stringProp(props, "key");
      const options = translateSelectOptions(props.options);
      if (key === undefined || press === undefined || options.length === 0) {
        return { type: "unsupported", element: type };
      }
      const label = stringProp(props, "label");
      const value = stringProp(props, "value");
      return {
        type: "select",
        key,
        ...press,
        options,
        ...(value === undefined ? {} : { value }),
        ...(label === undefined ? {} : { label }),
        ...autoFocusOf(props),
      };
    }
    case "Svg": {
      const source = stringProp(props, "source");
      // A lone surrogate cannot be encoded into the image a client draws.
      if (
        source === undefined ||
        source.length === 0 ||
        source.length > MAX_SVG_SOURCE_LENGTH ||
        !source.isWellFormed()
      ) {
        return { type: "unsupported", element: type };
      }
      const width = positiveNumberProp(props, "width", MAX_SVG_SIZE);
      const height = positiveNumberProp(props, "height", MAX_SVG_SIZE);
      return {
        type: "svg",
        source,
        alt: stringProp(props, "alt") ?? "",
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(props.isInteractive === true ? { interactive: true as const } : {}),
      };
    }
    default:
      return { type: "unsupported", element: type };
  }
}

export interface ClaudeModSurface {
  /**
   * Attaches as a remote surface and draws what is already open, in the
   * background. The thread shows mods as available only once Claude Code
   * accepts, so a CLI without mods never flashes an empty panel first. Run it
   * before the first message is handled.
   */
  readonly attach: Effect.Effect<void>;
  /** Consumes one `system/ui_*` push; returns false for any other message. */
  readonly handleMessage: (message: unknown) => Effect.Effect<boolean>;
  readonly act: (
    action: ModSurfaceAction,
  ) => Effect.Effect<ModSurfaceActResult, ClaudeModRequestError>;
  /** The process ended: everything it drew is gone. Emits once; later calls do nothing. */
  readonly detach: Effect.Effect<void>;
  /**
   * Stops emitting without saying so, for a process whose thread a newer one
   * already took over: a reset from it would wipe what the newer one drew.
   */
  readonly release: Effect.Effect<void>;
}

export function makeClaudeModSurface(input: {
  /** Absent when the SDK in use cannot send control requests of its own. */
  readonly request: ClaudeUiRequest | undefined;
  readonly emit: (event: ModSurfaceEvent) => Effect.Effect<void>;
  /** Draws run beside the message loop, so a slow mod never delays the transcript. */
  readonly scope: Scope.Scope;
}): ClaudeModSurface {
  const { request, scope } = input;
  let unsupported = request === undefined;
  // Set once the process ended or was replaced: nothing it still answers or
  // pushes reaches the thread after that.
  let detached = false;
  // Pushes that arrived before Claude Code answered `ui_attach`. They are
  // handled after the `available` reset, which would otherwise wipe them.
  // Null once the attach settled.
  let pending: Array<unknown> | null = [];
  let roster: ReadonlyArray<ModPaneSummary> = [];
  // False once Claude Code says no mod draws the band, until the next invalidate.
  let bandHooked = true;
  // A draw answers only if no later draw of the same site was asked meanwhile.
  const generations = new Map<string, number>();

  const emit = (event: ModSurfaceEvent) =>
    Effect.suspend(() => (detached ? Effect.void : input.emit(event)));

  const instanceIdOf = (site: ModSurfaceSite) =>
    site.component === "Pane" ? site.paneId : BAND_INSTANCE_ID;

  const siteKey = (site: ModSurfaceSite) =>
    site.component === "Pane" ? `Pane:${site.paneId}` : "AbovePrompt";

  const renderRequest = (site: ModSurfaceSite): ClaudeUiControlRequest => {
    if (site.component === "AbovePrompt") {
      return {
        subtype: "ui_render",
        surface: SURFACE,
        client_id: CLIENT_ID,
        component: "AbovePrompt",
        instance_id: instanceIdOf(site),
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: BAND_ROWS,
          bodyColumns: BAND_COLUMNS,
          scroll: { offset: 0, bodyRows: BAND_ROWS - 1 },
          view: {},
        },
        viewport: VIEWPORT,
      };
    }
    const title = roster.find((pane) => pane.id === site.paneId)?.title ?? site.paneId;
    return {
      subtype: "ui_render",
      surface: SURFACE,
      client_id: CLIENT_ID,
      component: "Pane",
      instance_id: instanceIdOf(site),
      props: {
        title,
        isFocused: false,
        bodyColumns: PANE_COLUMNS,
        placement: "dock",
        scroll: { offset: 0, bodyRows: PANE_ROWS },
        view: {},
      },
      viewport: VIEWPORT,
    };
  };

  const draw = (site: ModSurfaceSite): Effect.Effect<void> => {
    if (request === undefined || unsupported || detached) return Effect.void;
    if (site.component === "AbovePrompt" && !bandHooked) return Effect.void;
    const key = siteKey(site);
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    return request(renderRequest(site)).pipe(
      Effect.flatMap((answer) => {
        if (generations.get(key) !== generation) return Effect.void;
        const decoded = Option.getOrUndefined(decodeRenderAnswer(answer));
        if (decoded === undefined) return Effect.void;
        const tree = decoded.hooked ? translateClaudeUiTree(decoded.tree) : null;
        if (site.component === "AbovePrompt") {
          bandHooked = decoded.hooked;
          return emit({ type: "band", tree });
        }
        return roster.some((pane) => pane.id === site.paneId)
          ? emit({ type: "pane-tree", paneId: site.paneId, tree })
          : Effect.void;
      }),
      Effect.catchCause((cause) =>
        Effect.logDebug("orchestration-v2.claude-mods.render-failed", { site: key, cause }),
      ),
      Effect.asVoid,
      Effect.forkIn(scope),
      Effect.asVoid,
    );
  };

  const drawAll = Effect.suspend(() =>
    Effect.forEach(
      [
        ...roster.map((pane): ModSurfaceSite => ({ component: "Pane", paneId: pane.id })),
        { component: "AbovePrompt" } as const,
      ],
      draw,
      { discard: true },
    ),
  );

  const setRoster = (panes: ReadonlyArray<ModPaneSummary>) =>
    Effect.suspend(() => {
      const known = new Set(roster.map((pane) => pane.id));
      roster = panes;
      return emit({ type: "panes", panes }).pipe(
        Effect.andThen(
          Effect.forEach(
            panes.filter((pane) => !known.has(pane.id)),
            (pane) => draw({ component: "Pane", paneId: pane.id }),
            { discard: true },
          ),
        ),
      );
    });

  const rosterOf = (panes: ReadonlyArray<{ id: string; title: string; plugin: string }>) =>
    panes
      .filter((pane) => isPaneId(pane.id))
      .map((pane) => ({ id: pane.id, title: pane.title, plugin: pane.plugin }));

  const readRoster = (send: ClaudeUiRequest) =>
    // A pane opened before the attach pushed no roster: read it once.
    send({ subtype: "ui_panes", client_id: CLIENT_ID }).pipe(
      Effect.flatMap((answer) => {
        const decoded = Option.getOrUndefined(decodeRosterAnswer(answer));
        return decoded === undefined ? Effect.void : setRoster(rosterOf(decoded.panes));
      }),
      Effect.andThen(Effect.suspend(() => draw({ component: "AbovePrompt" }))),
      Effect.catchCause((cause) =>
        Effect.logDebug("orchestration-v2.claude-mods.roster-failed", { cause }),
      ),
    );

  // Handles the held pushes in order; a push arriving meanwhile joins the queue,
  // and only an empty queue lets later pushes through directly.
  const handlePending: Effect.Effect<void> = Effect.suspend(() => {
    const next = pending?.shift();
    if (next === undefined) {
      pending = null;
      return Effect.void;
    }
    return handlePush(next).pipe(Effect.andThen(handlePending));
  });

  const attachSurface = (send: ClaudeUiRequest) =>
    send({ subtype: "ui_attach", surface: SURFACE, client_id: CLIENT_ID, viewport: VIEWPORT }).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          unsupported = true;
          pending = null;
          roster = [];
          return Effect.logDebug("orchestration-v2.claude-mods.unsupported", { cause }).pipe(
            Effect.andThen(emit({ type: "reset", availability: "unsupported" })),
          );
        },
        onSuccess: () =>
          emit({ type: "reset", availability: "available" }).pipe(
            Effect.andThen(handlePending),
            Effect.andThen(readRoster(send)),
          ),
      }),
    );

  const attach = Effect.suspend(() => {
    if (request === undefined) {
      pending = null;
      return emit({ type: "reset", availability: "unsupported" });
    }
    return attachSurface(request).pipe(Effect.forkIn(scope), Effect.asVoid);
  });

  const handleMessage = (message: unknown): Effect.Effect<boolean> =>
    Effect.suspend(() => {
      if (!isClaudeUiPush(message)) return Effect.succeed(false);
      if (pending !== null) {
        pending.push(message);
        return Effect.succeed(true);
      }
      return handlePush(message).pipe(Effect.as(true));
    });

  const handlePush = (message: unknown): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (detached) return Effect.void;
      const push = Option.getOrUndefined(decodeClaudeUiPush(message));
      if (push === undefined) return Effect.void;
      switch (push.subtype) {
        case "ui_panes":
          return setRoster(rosterOf(push.panes));
        case "ui_invalidate": {
          bandHooked = true;
          const instances = push.instances?.filter((instance) => instance.surface === SURFACE);
          if (instances === undefined) return drawAll;
          return Effect.forEach(
            instances,
            (instance) =>
              instance.component === "AbovePrompt"
                ? draw({ component: "AbovePrompt" })
                : instance.component === "Pane" && isPaneId(instance.instance_id)
                  ? draw({ component: "Pane", paneId: instance.instance_id })
                  : Effect.void,
            { discard: true },
          );
        }
        case "ui_toast":
          return emit({
            type: "toast",
            toast: {
              id: push.uuid,
              plugin: push.plugin,
              text: push.text,
              timeoutMs: Math.max(0, Math.round(push.timeout_ms ?? 4000)),
            },
          });
        case "ui_status":
          return emit({ type: "status", plugin: push.plugin, text: push.text });
        case "ui_log":
          // A mod's transcript notes have no row in T3 Code's thread yet.
          return Effect.logDebug("orchestration-v2.claude-mods.log", {
            plugin: push.plugin,
            text: push.text,
          });
      }
    });

  const elementRequest = (
    action: Exclude<ModSurfaceAction, { type: "close-pane" }>,
  ): ClaudeUiControlRequest => {
    const target = {
      plugin: action.plugin,
      handle: action.handle,
      key: action.key,
      surface: SURFACE,
      client_id: CLIENT_ID,
    };
    // An edit or pick also names where the element was drawn: with `key`,
    // Claude Code re-resolves a handle a redraw retired, so typing across a
    // redraw is not lost. A press carries no such fields.
    const drawnAt = { component: action.site.component, instance_id: instanceIdOf(action.site) };
    switch (action.type) {
      case "press":
        return { subtype: "ui_press", ...target };
      case "input":
        return {
          subtype: "ui_input",
          ...target,
          ...drawnAt,
          kind: action.kind,
          value: action.value,
        };
      case "select":
        return { subtype: "ui_select", ...target, ...drawnAt, value: action.value };
    }
  };

  const act = (
    action: ModSurfaceAction,
  ): Effect.Effect<ModSurfaceActResult, ClaudeModRequestError> =>
    Effect.suspend(() => {
      if (request === undefined || unsupported || detached) {
        return Effect.succeed({ handled: false });
      }
      if (action.type === "close-pane") {
        return request({ subtype: "ui_close", id: action.paneId, client_id: CLIENT_ID }).pipe(
          Effect.map((answer) => ({
            handled: Option.getOrUndefined(decodeClosed(answer))?.closed ?? false,
          })),
        );
      }
      return request(elementRequest(action)).pipe(
        Effect.flatMap((answer) => {
          const handled = Option.getOrUndefined(decodeHandled(answer))?.handled ?? false;
          // An unhandled action means the client's drawing is stale: send a fresh one.
          return (handled ? Effect.void : draw(action.site)).pipe(Effect.as({ handled }));
        }),
      );
    });

  const release = Effect.sync(() => {
    detached = true;
    pending = null;
    roster = [];
    generations.clear();
  });

  const detach = Effect.suspend(() => {
    if (detached) return Effect.void;
    const availability = unsupported ? "unsupported" : "inactive";
    return release.pipe(Effect.andThen(input.emit({ type: "reset", availability })));
  });

  return { attach, handleMessage, act, detach, release };
}
