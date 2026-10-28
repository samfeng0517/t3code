import type { ModSurfaceView } from "@t3tools/client-runtime/state/mods";
import type { ModToast, ModUiNode, ModUiTone } from "@t3tools/contracts";

export type ModsPanelBody =
  | { readonly kind: "server-unsupported" }
  | { readonly kind: "loading" }
  | { readonly kind: "inactive" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "empty" }
  | { readonly kind: "panes" };

/** What the panel shows for the thread, before any mod's own drawing. */
export function modsPanelBody(
  serverSupportsMods: boolean,
  view: ModSurfaceView | null,
): ModsPanelBody {
  if (!serverSupportsMods) return { kind: "server-unsupported" };
  if (view === null) return { kind: "loading" };
  if (view.panes.length > 0) return { kind: "panes" };
  switch (view.availability) {
    case "inactive":
      return { kind: "inactive" };
    case "unsupported":
      return { kind: "unsupported" };
    case "available":
      return { kind: "empty" };
  }
}

/** The band above the composer shows only when a mod put something in it. */
export function hasModsBand(view: ModSurfaceView | null): boolean {
  return view !== null && (view.band !== null || view.statuses.length > 0);
}

/**
 * Toasts that arrived after the last one this view raised. When the last one
 * raised is no longer kept, every kept toast is new to this view.
 */
export function unseenModToasts(
  toasts: ReadonlyArray<ModToast>,
  lastRaisedId: string | null,
): ReadonlyArray<ModToast> {
  if (lastRaisedId === null) return toasts;
  const index = toasts.findIndex((toast) => toast.id === lastRaisedId);
  return index === -1 ? toasts : toasts.slice(index + 1);
}

/** Links a mod draws open only on the web: anything else reads as text. */
export function isOpenableModLink(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function modToneClassName(tone: ModUiTone | undefined): string | undefined {
  switch (tone) {
    case "error":
      return "text-destructive-foreground";
    case "success":
      return "text-success-foreground";
    case "warning":
      return "text-warning-foreground";
    case "info":
      return "text-info-foreground";
    case "muted":
      return "text-muted-foreground";
    case undefined:
      return undefined;
  }
}

/**
 * Sends one field's edits one at a time, in typed order: two requests in flight over the socket
 * may arrive out of order, so an older text could land after a newer one. Edits typed while one
 * is in flight collapse into the latest (each carries the whole text); a submit never collapses.
 */
export function createModActionQueue(onBusyChange: (busy: boolean) => void) {
  interface Entry {
    readonly send: () => Promise<unknown>;
    readonly collapsible: boolean;
    readonly settled: () => void;
  }
  const queue: Array<Entry> = [];
  let running = false;

  const drain = async () => {
    running = true;
    onBusyChange(true);
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        try {
          await next.send();
        } catch {
          // A failed send is reported by the command itself; later edits still go.
        }
        next.settled();
      }
    } finally {
      running = false;
      onBusyChange(false);
    }
  };

  return {
    /** Resolves once this action was sent and answered, or replaced by a later edit. */
    push(send: () => Promise<unknown>, options: { readonly collapsible: boolean }) {
      return new Promise<void>((settled) => {
        const last = queue.at(-1);
        if (options.collapsible && last?.collapsible === true) {
          queue.pop();
          last.settled();
        }
        queue.push({ send, collapsible: options.collapsible, settled });
        if (!running) void drain();
      });
    },
  };
}

/**
 * What a mod's field shows: the person's `text`, the `drawn` value it was last
 * reconciled with, and the texts sent since, which a mod echoes back late.
 */
export interface ModInputDraft {
  readonly text: string;
  readonly drawn: string;
  readonly sent: ReadonlyArray<string>;
}

const MAX_TRACKED_SENT_TEXTS = 32;

export function modInputDraft(drawn: string): ModInputDraft {
  return { text: drawn, drawn, sent: [] };
}

export function typeIntoModInput(draft: ModInputDraft, text: string): ModInputDraft {
  return { ...draft, text, sent: [...draft.sent, text].slice(-MAX_TRACKED_SENT_TEXTS) };
}

/**
 * Claude Code's own field empties itself once a submit was handled, unless the
 * person typed since; a later redraw replaces that only with a value that
 * differs from the one drawn before.
 */
export function clearAfterSubmit(draft: ModInputDraft, submittedText: string): ModInputDraft {
  return draft.text === submittedText ? { ...draft, text: "" } : draft;
}

/**
 * Takes a redraw's value into the field only when the mod changed it, not when
 * it echoes what the person typed: an echo of an older text, arriving after
 * newer typing, must not clobber it. While edits are still being sent the mod
 * has not seen the latest text, so a new value waits until they are done.
 */
export function reconcileModInput(
  draft: ModInputDraft,
  drawn: string,
  sending: boolean,
): ModInputDraft {
  if (drawn === draft.drawn) return draft;
  if (drawn === draft.text) return modInputDraft(drawn);
  if (draft.sent.includes(drawn)) return { ...draft, drawn };
  if (sending) return draft;
  return modInputDraft(drawn);
}

/**
 * A mod's SVG as an image source. An `<img>` runs none of the markup's scripts
 * and fetches nothing it references, so the markup needs no sanitizing. Null
 * for markup that cannot be encoded (a lone surrogate makes
 * `encodeURIComponent` throw), which the client draws as its alt text.
 */
export function modSvgImageSource(source: string): string | null {
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  } catch {
    return null;
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
// Claude Code bounds a mod's SVG to this size; markup that declares more is drawn no larger.
const MAX_MOD_SVG_SIZE = 4096;
// What an <img> of SVG markup that declares no size takes, as a replaced element.
const DEFAULT_MOD_SVG_FRAME = { width: 300, height: 150 } as const;
// The frame draws the markup's own styles and inline images and fetches nothing,
// as the <img> path does; links inside it still navigate the frame.
const MOD_SVG_FRAME_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

export interface ModSvgIntrinsicSize {
  readonly width?: number;
  readonly height?: number;
  /** Width over height, from the markup's viewBox, else its own width and height. */
  readonly aspect?: number;
}

function svgLength(value: string | null): number | undefined {
  const match = value === null ? null : /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value);
  const length = match === null ? Number.NaN : Number(match[1]);
  return length > 0 ? Math.min(length, MAX_MOD_SVG_SIZE) : undefined;
}

/**
 * A mod's SVG markup parsed as an <img> would read it: null unless well-formed XML with an `<svg>`
 * root. `markup` is that root re-serialized and the frame parses it as HTML, which can read some of
 * it differently, so this is no sanitizer: the frame's sandbox and policy are the security boundary.
 */
export function parseModSvg(
  source: string,
): { readonly markup: string; readonly intrinsic: ModSvgIntrinsicSize } | null {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.namespaceURI !== SVG_NAMESPACE ||
    root.localName !== "svg" ||
    parsed.getElementsByTagName("parsererror").length > 0
  ) {
    return null;
  }
  const width = svgLength(root.getAttribute("width"));
  const height = svgLength(root.getAttribute("height"));
  const viewBox = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const aspect =
    viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0
      ? viewBox[2]! / viewBox[3]!
      : width !== undefined && height !== undefined
        ? width / height
        : undefined;
  return {
    markup: new XMLSerializer().serializeToString(root),
    intrinsic: {
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(aspect === undefined ? {} : { aspect }),
    },
  };
}

/**
 * The frame's size in pixels, as an <img> of the same markup would take it: a
 * side the mod leaves out follows the markup's own proportions.
 */
export function modSvgFrameSize(
  drawn: { readonly width?: number | undefined; readonly height?: number | undefined },
  intrinsic: ModSvgIntrinsicSize,
): { readonly width: number; readonly height: number } {
  const aspect = intrinsic.aspect ?? DEFAULT_MOD_SVG_FRAME.width / DEFAULT_MOD_SVG_FRAME.height;
  const unsized = drawn.width === undefined && drawn.height === undefined;
  const width = drawn.width ?? (unsized ? intrinsic.width : undefined);
  const height = drawn.height ?? (unsized ? intrinsic.height : undefined);
  const bounded = (side: number) => Math.min(side, MAX_MOD_SVG_SIZE);
  if (width !== undefined && height !== undefined) return { width, height };
  if (width !== undefined) return { width, height: bounded(width / aspect) };
  if (height !== undefined) return { width: bounded(height * aspect), height };
  return {
    width: DEFAULT_MOD_SVG_FRAME.width,
    height: bounded(DEFAULT_MOD_SVG_FRAME.width / aspect),
  };
}

/** The document an interactive SVG's sandboxed frame draws. */
export function modSvgFrameDocument(markup: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${MOD_SVG_FRAME_POLICY}">` +
    `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}` +
    `body>svg{display:block;width:100%;height:100%}</style>` +
    `</head><body>${markup}</body></html>`
  );
}

/**
 * Whether the focused element takes typed text, so a mod's autofocus must not
 * take the keyboard from it. A focused frame (a preview, a terminal) counts.
 */
export function isTextEntryElement(element: {
  readonly tagName: string;
  readonly isContentEditable: boolean;
}): boolean {
  switch (element.tagName) {
    case "INPUT":
    case "TEXTAREA":
    case "SELECT":
    case "IFRAME":
      return true;
    default:
      return element.isContentEditable;
  }
}

/** Whether a drawing holds a control the mod asked to take the focus. */
export function hasModAutoFocus(node: ModUiNode): boolean {
  switch (node.type) {
    case "box":
      return node.children.some(hasModAutoFocus);
    case "button":
    case "input":
    case "select":
      return node.autoFocus === true;
    default:
      return false;
  }
}
