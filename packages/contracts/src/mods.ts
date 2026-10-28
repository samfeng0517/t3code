import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/**
 * Claude Code mods draw panes, a band above the prompt, status lines and
 * toasts. The adapter asks the provider to draw each site for a remote surface
 * and translates the provider's element tree into these nodes, so clients
 * render plain data and never see the provider's wire shape.
 */

/** A pane's id as the mod opened it: what its button presses and closes name. */
export const ModPaneId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));
export type ModPaneId = typeof ModPaneId.Type;

export const ModUiTone = Schema.Literals(["error", "success", "warning", "info", "muted"]);
export type ModUiTone = typeof ModUiTone.Type;

export interface ModUiLink {
  readonly type: "link";
  readonly href: string;
  readonly label?: string;
}

export interface ModUiText {
  readonly type: "text";
  readonly tone?: ModUiTone;
  readonly bold?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly strikethrough?: true;
  readonly children: ReadonlyArray<string | ModUiText | ModUiLink>;
}

export interface ModUiBox {
  readonly type: "box";
  readonly direction: "row" | "column";
  readonly bordered?: true;
  readonly children: ReadonlyArray<ModUiNode>;
}

/** `plugin` and `handle` name the press handler the provider keeps for this drawing. */
export interface ModUiButton {
  readonly type: "button";
  readonly key: string;
  readonly label: string;
  readonly plugin: string;
  readonly handle: number;
  readonly variant?: "primary";
  readonly dismiss?: true;
  /** Takes the focus when its site first shows; the first such control in tree order wins. */
  readonly autoFocus?: true;
}

export interface ModUiMarkdown {
  readonly type: "markdown";
  readonly text: string;
}

export interface ModUiCode {
  readonly type: "code";
  readonly source: string;
  readonly language?: string;
  readonly diff?: true;
}

/**
 * A text field. The client keeps what the person types; `value` is the text the
 * mod drew it with. `rows` of 2 or more draws a field of several lines.
 */
export interface ModUiInput {
  readonly type: "input";
  readonly key: string;
  readonly plugin: string;
  readonly handle: number;
  readonly value: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly submitLabel?: string;
  readonly rows?: number;
  readonly autoFocus?: true;
}

export interface ModUiSelectOption {
  readonly value: string;
  readonly label?: string;
}

/** A one-of-several picker; `value` is the option selected when drawn. */
export interface ModUiSelect {
  readonly type: "select";
  readonly key: string;
  readonly plugin: string;
  readonly handle: number;
  readonly options: ReadonlyArray<ModUiSelectOption>;
  readonly value?: string;
  readonly label?: string;
  readonly autoFocus?: true;
}

/**
 * SVG markup the client draws in isolation; `width`/`height` are pixels. An
 * `interactive` one is drawn in a sandboxed frame, where hover styles and links
 * inside it work; it still runs no scripts and reports nothing back to the mod.
 */
export interface ModUiSvg {
  readonly type: "svg";
  readonly source: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
  readonly interactive?: true;
}

/** An element this client cannot draw yet (a custom frame, or one from a newer provider). */
export interface ModUiUnsupported {
  readonly type: "unsupported";
  readonly element: string;
}

export type ModUiNode =
  | ModUiBox
  | ModUiText
  | ModUiLink
  | ModUiButton
  | ModUiMarkdown
  | ModUiCode
  | ModUiInput
  | ModUiSelect
  | ModUiSvg
  | ModUiUnsupported;

export const ModUiLink: Schema.Codec<ModUiLink> = Schema.Struct({
  type: Schema.Literal("link"),
  href: Schema.String,
  label: Schema.optionalKey(Schema.String),
});

export const ModUiText: Schema.Codec<ModUiText> = Schema.Struct({
  type: Schema.Literal("text"),
  tone: Schema.optionalKey(ModUiTone),
  bold: Schema.optionalKey(Schema.Literal(true)),
  italic: Schema.optionalKey(Schema.Literal(true)),
  underline: Schema.optionalKey(Schema.Literal(true)),
  strikethrough: Schema.optionalKey(Schema.Literal(true)),
  children: Schema.Array(
    Schema.Union([
      Schema.String,
      Schema.suspend((): Schema.Codec<ModUiText> => ModUiText),
      ModUiLink,
    ]),
  ),
});

export const ModUiButton: Schema.Codec<ModUiButton> = Schema.Struct({
  type: Schema.Literal("button"),
  key: Schema.String,
  label: Schema.String,
  plugin: Schema.String,
  handle: Schema.Int,
  variant: Schema.optionalKey(Schema.Literal("primary")),
  dismiss: Schema.optionalKey(Schema.Literal(true)),
  autoFocus: Schema.optionalKey(Schema.Literal(true)),
});

/** Claude Code bounds a field's text and a picked value to this many characters. */
export const MOD_UI_VALUE_MAX_LENGTH = 16_384;
const ModUiValue = Schema.String.check(Schema.isMaxLength(MOD_UI_VALUE_MAX_LENGTH));

export const ModUiInput: Schema.Codec<ModUiInput> = Schema.Struct({
  type: Schema.Literal("input"),
  key: Schema.String,
  plugin: Schema.String,
  handle: Schema.Int,
  value: Schema.String,
  label: Schema.optionalKey(Schema.String),
  placeholder: Schema.optionalKey(Schema.String),
  submitLabel: Schema.optionalKey(Schema.String),
  rows: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  autoFocus: Schema.optionalKey(Schema.Literal(true)),
});

export const ModUiSelect: Schema.Codec<ModUiSelect> = Schema.Struct({
  type: Schema.Literal("select"),
  key: Schema.String,
  plugin: Schema.String,
  handle: Schema.Int,
  options: Schema.Array(
    Schema.Struct({ value: Schema.String, label: Schema.optionalKey(Schema.String) }),
  ),
  value: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  autoFocus: Schema.optionalKey(Schema.Literal(true)),
});

export const ModUiSvg: Schema.Codec<ModUiSvg> = Schema.Struct({
  type: Schema.Literal("svg"),
  source: Schema.String,
  alt: Schema.String,
  width: Schema.optionalKey(Schema.Number),
  height: Schema.optionalKey(Schema.Number),
  interactive: Schema.optionalKey(Schema.Literal(true)),
});

export const ModUiNode: Schema.Codec<ModUiNode> = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("box"),
    direction: Schema.Literals(["row", "column"]),
    bordered: Schema.optionalKey(Schema.Literal(true)),
    children: Schema.Array(Schema.suspend((): Schema.Codec<ModUiNode> => ModUiNode)),
  }),
  ModUiText,
  ModUiLink,
  ModUiButton,
  Schema.Struct({ type: Schema.Literal("markdown"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("code"),
    source: Schema.String,
    language: Schema.optionalKey(Schema.String),
    diff: Schema.optionalKey(Schema.Literal(true)),
  }),
  ModUiInput,
  ModUiSelect,
  ModUiSvg,
  Schema.Struct({ type: Schema.Literal("unsupported"), element: Schema.String }),
]);

/** The pane's roster entry, as the provider lists it. */
export const ModPaneSummary = Schema.Struct({
  id: ModPaneId,
  plugin: Schema.String,
  title: Schema.String,
});
export type ModPaneSummary = typeof ModPaneSummary.Type;

/** `tree` is null until the pane is first drawn, or when no mod draws it. */
export const ModPane = Schema.Struct({
  ...ModPaneSummary.fields,
  tree: Schema.NullOr(ModUiNode),
});
export type ModPane = typeof ModPane.Type;

export const ModStatusLine = Schema.Struct({ plugin: Schema.String, text: Schema.String });
export type ModStatusLine = typeof ModStatusLine.Type;

export const ModToast = Schema.Struct({
  id: Schema.String,
  plugin: Schema.String,
  text: Schema.String,
  timeoutMs: Schema.Int,
});
export type ModToast = typeof ModToast.Type;

/**
 * `inactive`: no live provider process for the thread, so nothing is drawn.
 * `unsupported`: the live process does not speak the mods protocol (another
 * provider, or a Claude Code release from before it).
 */
export const ModSurfaceAvailability = Schema.Literals(["inactive", "available", "unsupported"]);
export type ModSurfaceAvailability = typeof ModSurfaceAvailability.Type;

export const ModSurfaceState = Schema.Struct({
  availability: ModSurfaceAvailability,
  panes: Schema.Array(ModPane),
  band: Schema.NullOr(ModUiNode),
  statuses: Schema.Array(ModStatusLine),
});
export type ModSurfaceState = typeof ModSurfaceState.Type;

export const EMPTY_MOD_SURFACE_STATE: ModSurfaceState = {
  availability: "inactive",
  panes: [],
  band: null,
  statuses: [],
};

/** What changed on one thread's mod surface. Toasts are live only and never kept. */
export const ModSurfaceEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("reset"), availability: ModSurfaceAvailability }),
  Schema.Struct({ type: Schema.Literal("panes"), panes: Schema.Array(ModPaneSummary) }),
  Schema.Struct({
    type: Schema.Literal("pane-tree"),
    paneId: ModPaneId,
    tree: Schema.NullOr(ModUiNode),
  }),
  Schema.Struct({ type: Schema.Literal("band"), tree: Schema.NullOr(ModUiNode) }),
  Schema.Struct({
    type: Schema.Literal("status"),
    plugin: Schema.String,
    text: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("toast"), toast: ModToast }),
]);
export type ModSurfaceEvent = typeof ModSurfaceEvent.Type;

/** A subscription's first frame is a snapshot; events follow. */
export const ModSurfaceFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), state: ModSurfaceState }),
  ModSurfaceEvent,
]);
export type ModSurfaceFrame = typeof ModSurfaceFrame.Type;

export function applyModSurfaceEvent(
  state: ModSurfaceState,
  event: ModSurfaceEvent,
): ModSurfaceState {
  switch (event.type) {
    case "reset":
      return { ...EMPTY_MOD_SURFACE_STATE, availability: event.availability };
    case "panes": {
      // A roster entry keeps the tree it was drawn with until it is redrawn.
      const trees = new Map(state.panes.map((pane) => [pane.id, pane.tree]));
      return {
        ...state,
        panes: event.panes.map((pane) => ({ ...pane, tree: trees.get(pane.id) ?? null })),
      };
    }
    case "pane-tree":
      if (!state.panes.some((pane) => pane.id === event.paneId)) return state;
      return {
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === event.paneId ? { ...pane, tree: event.tree } : pane,
        ),
      };
    case "band":
      return { ...state, band: event.tree };
    case "status": {
      const others = state.statuses.filter((line) => line.plugin !== event.plugin);
      return {
        ...state,
        statuses:
          event.text === null || event.text.length === 0
            ? others
            : [...others, { plugin: event.plugin, text: event.text }],
      };
    }
    case "toast":
      return state;
  }
}

export const ModSurfaceSite = Schema.Union([
  Schema.Struct({ component: Schema.Literal("Pane"), paneId: ModPaneId }),
  Schema.Struct({ component: Schema.Literal("AbovePrompt") }),
]);
export type ModSurfaceSite = typeof ModSurfaceSite.Type;

export const ModSurfaceAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("press"),
    site: ModSurfaceSite,
    plugin: Schema.String,
    handle: Schema.Int,
    key: Schema.String,
  }),
  /** `change` on an edit of the field, `submit` on Enter; `value` is the field's whole text. */
  Schema.Struct({
    type: Schema.Literal("input"),
    site: ModSurfaceSite,
    plugin: Schema.String,
    handle: Schema.Int,
    key: Schema.String,
    kind: Schema.Literals(["change", "submit"]),
    value: ModUiValue,
  }),
  Schema.Struct({
    type: Schema.Literal("select"),
    site: ModSurfaceSite,
    plugin: Schema.String,
    handle: Schema.Int,
    key: Schema.String,
    value: ModUiValue,
  }),
  Schema.Struct({ type: Schema.Literal("close-pane"), paneId: ModPaneId }),
]);
export type ModSurfaceAction = typeof ModSurfaceAction.Type;

export const ModSurfaceSubscribeInput = Schema.Struct({ threadId: ThreadId });
export type ModSurfaceSubscribeInput = typeof ModSurfaceSubscribeInput.Type;

export const ModSurfaceActInput = Schema.Struct({
  threadId: ThreadId,
  action: ModSurfaceAction,
});
export type ModSurfaceActInput = typeof ModSurfaceActInput.Type;

/**
 * False when the drawing the client acted on was stale (or a pick named no
 * option it drew); a fresh one follows.
 */
export const ModSurfaceActResult = Schema.Struct({ handled: Schema.Boolean });
export type ModSurfaceActResult = typeof ModSurfaceActResult.Type;

export const ModSurfaceActionErrorReason = Schema.Literals([
  "session-stopped",
  "provider-unsupported",
  "request-failed",
]);
export type ModSurfaceActionErrorReason = typeof ModSurfaceActionErrorReason.Type;

export class ModSurfaceActionError extends Schema.TaggedError<ModSurfaceActionError>()(
  "ModSurfaceActionError",
  {
    threadId: ThreadId,
    reason: ModSurfaceActionErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "session-stopped":
        return "The agent session that drew this mod has stopped.";
      case "provider-unsupported":
        return "This provider does not run mods.";
      case "request-failed":
        return "The mod did not answer.";
    }
  }
}

export const isModSurfaceActionError = Schema.is(ModSurfaceActionError);
