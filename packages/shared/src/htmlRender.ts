import {
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  type ThemeAppearance,
  type ThemeColors,
} from "./themePalettes.ts";
import { EVENT_CODE_SHORTCUT_KEYS } from "./keybindings.ts";

export const HTML_RENDER_TOOL_NAME = "html_render";
export const HTML_RENDER_MIN_HEIGHT = 80;
export const HTML_RENDER_MAX_HEIGHT = 2000;
// A client fits the frame to the live page up to this height. It only stops a
// page that grows with its frame, since vh units are rejected at publish.
export const HTML_RENDER_MAX_FIT_HEIGHT = 20_000;
export const HTML_RENDER_MAX_TITLE_LENGTH = 200;

export interface HtmlRenderReference {
  readonly attachmentId: string;
  readonly title: string;
  readonly height: number;
  readonly heights?: ReadonlyArray<readonly [width: number, height: number]>;
}

export const HTML_RENDER_MEASURE_WIDTHS = [320, 375, 430, 520, 640, 728, 860, 1000, 1144] as const;

export const HTML_RENDER_COLUMN_WIDTH = 728;

const MAX_MEASURED_HEIGHTS = 24;

function readMeasuredHeights(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MEASURED_HEIGHTS) {
    return undefined;
  }
  const heights = value.flatMap((entry) =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    Number.isInteger(entry[0]) &&
    entry[0] >= 1 &&
    entry[0] <= 10_000 &&
    typeof entry[1] === "number" &&
    Number.isFinite(entry[1])
      ? [[entry[0] as number, clampHtmlRenderHeight(entry[1])] as const]
      : [],
  );
  return heights.length === value.length
    ? [...heights].sort((left, right) => left[0] - right[0])
    : undefined;
}

export function readHtmlRenderReference(value: unknown): HtmlRenderReference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { attachmentId, title, height, heights } = value as Record<string, unknown>;
  if (
    typeof attachmentId !== "string" ||
    attachmentId.length === 0 ||
    attachmentId.length > 256 ||
    typeof title !== "string" ||
    typeof height !== "number" ||
    !Number.isFinite(height)
  ) {
    return undefined;
  }
  const measured = readMeasuredHeights(heights);
  return {
    attachmentId,
    title: title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "HTML",
    height: clampHtmlRenderHeight(height),
    ...(measured === undefined ? {} : { heights: measured }),
  };
}

export function htmlRenderReferencesEqual(left: HtmlRenderReference, right: HtmlRenderReference) {
  return (
    left.attachmentId === right.attachmentId &&
    left.title === right.title &&
    left.height === right.height &&
    (left.heights ?? []).length === (right.heights ?? []).length &&
    (left.heights ?? []).every(
      ([width, height], index) =>
        right.heights?.[index]?.[0] === width && right.heights[index][1] === height,
    )
  );
}

// Use the taller neighboring measurement because breakpoints can select either height.
function measuredHeight(heights: NonNullable<HtmlRenderReference["heights"]>, width: number) {
  const above = heights.findIndex(([measuredWidth]) => measuredWidth >= width);
  const high = above === -1 ? heights.length - 1 : above;
  const low = heights[high]![0] === width ? high : Math.max(0, high - 1);
  return Math.max(heights[low]![1], heights[high]![1]);
}

/**
 * A page even a few pixels taller than its frame scrolls inside it and takes
 * the reader's scroll, so the frame fits the page. A client that measured the
 * live page passes `contentHeight`, which wins over the agent's height: client
 * fonts often wrap the page taller than the server or agent measured it.
 */
export function htmlRenderFrameHeight(
  reference: HtmlRenderReference,
  width: number,
  contentHeight?: number,
) {
  if (contentHeight !== undefined) {
    return Math.min(
      HTML_RENDER_MAX_FIT_HEIGHT,
      Math.max(HTML_RENDER_MIN_HEIGHT, Math.ceil(contentHeight)),
    );
  }
  const heights = reference.heights;
  if (heights === undefined || heights.length === 0) {
    return clampHtmlRenderHeight(reference.height);
  }
  const cap =
    measuredHeight(heights, HTML_RENDER_COLUMN_WIDTH) > reference.height
      ? reference.height
      : HTML_RENDER_MAX_HEIGHT;
  return clampHtmlRenderHeight(Math.min(cap, measuredHeight(heights, width)));
}

export function htmlRenderFileName(title: string) {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${name || "Page"}.html`;
}

export function clampHtmlRenderHeight(height: number): number {
  return Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.round(height)));
}

export interface HtmlRenderFonts {
  readonly sans: string;
  readonly mono: string;
}

export const HTML_RENDER_DEFAULT_FONTS: HtmlRenderFonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  // Concrete names only: some engines alias `ui-monospace` to the proportional UI font.
  mono: '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

/** Arial-metric substitutes keep measured wrapping close to client system fonts. */
export const HTML_RENDER_MEASURE_FONTS: HtmlRenderFonts = {
  sans: '"Liberation Sans", Arimo, Arial, Helvetica, sans-serif',
  mono: '"Liberation Mono", Cousine, Menlo, Consolas, monospace',
};

export interface HtmlRenderTheme {
  readonly appearance: ThemeAppearance;
  readonly variables: Readonly<Record<string, string>>;
}

const FIXED_COLORS = {
  light: {
    success: "#10b981",
    successForeground: "#047857",
    info: "#3b82f6",
    infoForeground: "#1d4ed8",
    chart: ["#0d9488", "#d97706", "#9333ea", "#e11d48", "#65a30d"],
  },
  dark: {
    success: "#10b981",
    successForeground: "#34d399",
    info: "#3b82f6",
    infoForeground: "#60a5fa",
    chart: ["#2dd4bf", "#fbbf24", "#c084fc", "#fb7185", "#a3e635"],
  },
} as const;

/** Uses app tokens, except --accent is the brand color rather than a neutral hover surface. */
export function htmlRenderTheme(
  colors: ThemeColors,
  appearance: ThemeAppearance,
  fonts: HtmlRenderFonts = HTML_RENDER_DEFAULT_FONTS,
): HtmlRenderTheme {
  const fixed = FIXED_COLORS[appearance];
  return {
    appearance,
    variables: {
      "--background": colors.canvas,
      "--foreground": colors.text,
      "--muted": colors.muted,
      "--muted-foreground": colors.mutedForeground,
      "--card": colors.surface,
      "--card-foreground": colors.text,
      "--popover": colors.surfaceOverlay,
      "--popover-foreground": colors.text,
      "--secondary": colors.secondary,
      "--secondary-foreground": colors.secondaryForeground,
      "--border": colors.border,
      "--input": colors.input,
      "--ring": colors.focus,
      "--primary": colors.messageAction,
      "--primary-foreground": colors.messageActionForeground,
      "--accent": colors.accent,
      "--accent-foreground": colors.accentForeground,
      "--accent-surface": colors.accentSurface,
      "--accent-surface-foreground": colors.accentSurfaceForeground,
      "--destructive": colors.error,
      "--destructive-foreground": colors.errorForeground,
      "--destructive-surface": colors.errorSurface,
      "--warning": colors.warning,
      "--warning-foreground": colors.warningForeground,
      "--warning-surface": colors.warningSurface,
      "--success": fixed.success,
      "--success-foreground": fixed.successForeground,
      "--info": fixed.info,
      "--info-foreground": fixed.infoForeground,
      "--code-background": colors.codeBackground,
      "--code-foreground": colors.codeForeground,
      "--chart-1": colors.accent,
      ...Object.fromEntries(fixed.chart.map((color, index) => [`--chart-${index + 2}`, color])),
      "--radius": "0.625rem",
      "--font-sans": fonts.sans,
      "--font-mono": fonts.mono,
    },
  };
}

export const HTML_RENDER_THEME_GUIDE = [
  "Use theme CSS variables on :root, not fixed colors:",
  "--background, --foreground, --muted, --card, --popover, --secondary, --border, --ring, --primary, --accent, --destructive, --warning, --success, --info, --code-background",
  "(most have a matching -foreground; accent, destructive, and warning also have -surface),",
  "--chart-1 to --chart-6, --radius, --font-sans, --font-mono.",
  "The base sheet sets background, text, and font.",
].join(" ");

export const HTML_RENDER_LAYOUT_GUIDE = [
  `Frame width is reply width (${HTML_RENDER_COLUMN_WIDTH}px desktop, about 360px phones), on the thread background.`,
  "Leave html, body, and the outer element with no background color, no outer card, border, banner title, or side padding. This wins over any rule that sets a page background.",
  "A box that needs its own background gets 16px padding and var(--radius) corners. Give charts fixed pixel heights.",
  "Let content set the height. Do not use vh units or height:100% on html or body. Both are rejected or loop.",
].join(" ");

const HOST_CONTEXT_CHANGED_METHOD = "ui/notifications/host-context-changed";
const OPEN_LINK_METHOD = "ui/open-link";
const SIZE_CHANGED_METHOD = "ui/notifications/size-changed";
// Custom bridge forwards app shortcuts because focused frames otherwise capture them.
const SHORTCUTS_METHOD = "t3/notifications/shortcuts";
const KEY_DOWN_METHOD = "t3/notifications/keydown";
const OPEN_IMAGE_METHOD = "t3/notifications/open-image";

// Not part of MCP Apps: a reader commenting on a framed page asks it which
// element sits under a point. The page only answers; comment pins stay in the
// client's overlay and never enter the page.
const COMMENT_ANCHOR_REQUEST_METHOD = "t3/request/comment-anchor";
const COMMENT_ANCHOR_METHOD = "t3/notifications/comment-anchor";
// Re-finds anchored elements after a load or resize, and from then on reports
// the page's scroll and size so pins follow a frame that scrolls inside.
const COMMENT_RESOLVE_REQUEST_METHOD = "t3/request/comment-anchors";
const COMMENT_RESOLVE_METHOD = "t3/notifications/comment-anchors";
const COMMENT_VIEW_METHOD = "t3/notifications/comment-view";
// While the reader picks, a layer over the frame takes the wheel, so it asks the page to scroll.
const COMMENT_SCROLL_REQUEST_METHOD = "t3/request/comment-scroll";
const COMMENT_ANCHOR_TEXT_MAX_CHARS = 500;
const COMMENT_SELECTOR_MAX_CHARS = 512;
const COMMENT_RESOLVE_SELECTORS_MAX = 200;

export function readHtmlRenderContentHeight(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== SIZE_CHANGED_METHOD) return undefined;
  const height =
    typeof params === "object" && params !== null
      ? (params as { height?: unknown }).height
      : undefined;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
}

export function readHtmlRenderLinkRequest(data: unknown):
  | {
      readonly id: string | number;
      readonly url: string;
      readonly metaKey: boolean;
      readonly ctrlKey: boolean;
    }
  | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, id, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== OPEN_LINK_METHOD) return undefined;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  if (typeof params !== "object" || params === null) return undefined;
  const { url, metaKey, ctrlKey } = params as Record<string, unknown>;
  return typeof url === "string" && /^https?:\/\//i.test(url)
    ? { id, url, metaKey: metaKey === true, ctrlKey: ctrlKey === true }
    : undefined;
}

/** Published local images arrive as `data:image/` URLs. */
export function readHtmlRenderImageRequest(
  data: unknown,
): { readonly src: string; readonly name: string } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== OPEN_IMAGE_METHOD) return undefined;
  if (typeof params !== "object" || params === null) return undefined;
  const { src, name } = params as Record<string, unknown>;
  if (typeof src !== "string" || !/^(?:https?:\/\/|data:image\/)/i.test(src)) return undefined;
  const label = typeof name === "string" ? name.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) : "";
  return { src, name: label || "Image" };
}

export function readHtmlRenderKeyDown(data: unknown):
  | {
      readonly key: string;
      readonly code: string;
      readonly metaKey: boolean;
      readonly ctrlKey: boolean;
      readonly shiftKey: boolean;
      readonly altKey: boolean;
      readonly repeat: boolean;
    }
  | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== KEY_DOWN_METHOD) return undefined;
  if (typeof params !== "object" || params === null) return undefined;
  const { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat } = params as Record<
    string,
    unknown
  >;
  if (typeof key !== "string" || typeof code !== "string") return undefined;
  return {
    key,
    code,
    metaKey: metaKey === true,
    ctrlKey: ctrlKey === true,
    shiftKey: shiftKey === true,
    altKey: altKey === true,
    repeat: repeat === true,
  };
}

export interface HtmlRenderCommentAnchorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Asks a framed render about the viewport rectangle a reader picked. */
export function htmlRenderCommentAnchorRequest(
  requestId: string,
  rect: HtmlRenderCommentAnchorRect,
) {
  return {
    jsonrpc: "2.0",
    method: COMMENT_ANCHOR_REQUEST_METHOD,
    params: { requestId, ...rect },
  } as const;
}

export interface HtmlRenderCommentAnchor {
  readonly requestId: string;
  readonly page: { readonly width: number; readonly height: number };
  readonly scroll: { readonly x: number; readonly y: number };
  /** The element under the picked point, in page coordinates; absent over the bare page. */
  readonly element?: {
    readonly selector: string;
    readonly tagName: string;
    readonly text: string;
    readonly rect: HtmlRenderCommentAnchorRect;
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const readRect = (value: unknown): HtmlRenderCommentAnchorRect | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  return finite(x) && finite(y) && finite(width) && finite(height) && width >= 0 && height >= 0
    ? { x, y, width, height }
    : undefined;
};

const flatText = (text: unknown) =>
  typeof text === "string"
    ? text.replace(/\s+/g, " ").trim().slice(0, COMMENT_ANCHOR_TEXT_MAX_CHARS)
    : "";

/** The page's scrollable size and scroll offset, in its own CSS pixels. */
export interface HtmlRenderCommentView {
  readonly page: { readonly width: number; readonly height: number };
  readonly scroll: { readonly x: number; readonly y: number };
}

function readView(params: Record<string, unknown>): HtmlRenderCommentView | undefined {
  const { page, scroll } = params;
  const pageRect = readRect({ x: 0, y: 0, ...(page as object) });
  const scrollRect = readRect({ width: 0, height: 0, ...(scroll as object) });
  if (!pageRect || !scrollRect || pageRect.width <= 0 || pageRect.height <= 0) return undefined;
  return {
    page: { width: pageRect.width, height: pageRect.height },
    scroll: { x: scrollRect.x, y: scrollRect.y },
  };
}

function readParams(data: unknown, method: string): Record<string, unknown> | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method: received, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || received !== method) return undefined;
  return typeof params === "object" && params !== null
    ? (params as Record<string, unknown>)
    : undefined;
}

/**
 * A framed render's answer to `htmlRenderCommentAnchorRequest`. The page can
 * write any answer, so strings are bounded and numbers checked; what it says
 * only describes the reader's own comment.
 */
export function readHtmlRenderCommentAnchor(data: unknown): HtmlRenderCommentAnchor | undefined {
  const params = readParams(data, COMMENT_ANCHOR_METHOD);
  if (!params) return undefined;
  const { requestId, selector, tagName, text, rect } = params;
  const view = readView(params);
  if (typeof requestId !== "string" || !view) return undefined;
  const elementRect = readRect(rect);
  return {
    requestId,
    ...view,
    ...(elementRect && typeof selector === "string" && typeof tagName === "string"
      ? {
          element: {
            // A cut path would name some other element, so an overlong one names none.
            selector: selector.length <= COMMENT_SELECTOR_MAX_CHARS ? selector : "",
            tagName: tagName.toLowerCase().slice(0, 64),
            text: flatText(text),
            rect: elementRect,
          },
        }
      : {}),
  };
}

/** Asks a framed page where the elements behind saved comments are now. */
export function htmlRenderCommentAnchorsRequest(
  requestId: string,
  selectors: ReadonlyArray<string>,
) {
  return {
    jsonrpc: "2.0",
    method: COMMENT_RESOLVE_REQUEST_METHOD,
    params: { requestId, selectors: selectors.slice(0, COMMENT_RESOLVE_SELECTORS_MAX) },
  } as const;
}

export interface HtmlRenderResolvedAnchor {
  readonly text: string;
  readonly rect: HtmlRenderCommentAnchorRect;
}

export interface HtmlRenderCommentAnchors extends HtmlRenderCommentView {
  readonly requestId: string;
  /** One entry per requested selector, in order; null where nothing matches. */
  readonly anchors: ReadonlyArray<HtmlRenderResolvedAnchor | null>;
}

export function readHtmlRenderCommentAnchors(data: unknown): HtmlRenderCommentAnchors | undefined {
  const params = readParams(data, COMMENT_RESOLVE_METHOD);
  if (!params) return undefined;
  const { requestId, anchors } = params;
  const view = readView(params);
  if (typeof requestId !== "string" || !view || !Array.isArray(anchors)) return undefined;
  return {
    requestId,
    ...view,
    anchors: anchors.slice(0, COMMENT_RESOLVE_SELECTORS_MAX).map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return null;
      const { rect, text } = entry as Record<string, unknown>;
      const checked = readRect(rect);
      return checked ? { rect: checked, text: flatText(text) } : null;
    }),
  };
}

/** Scrolls a framed page by CSS pixels on behalf of the comment layer over it. */
export function htmlRenderCommentScrollRequest(x: number, y: number) {
  return { jsonrpc: "2.0", method: COMMENT_SCROLL_REQUEST_METHOD, params: { x, y } } as const;
}

/** The page's scroll or size changed after the client asked about its anchors. */
export function readHtmlRenderCommentView(data: unknown): HtmlRenderCommentView | undefined {
  const params = readParams(data, COMMENT_VIEW_METHOD);
  return params ? readView(params) : undefined;
}

export interface HtmlRenderShortcut {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function htmlRenderShortcutsMessage(
  shortcuts: ReadonlyArray<HtmlRenderShortcut>,
  blocked: ReadonlyArray<HtmlRenderShortcut>,
) {
  return { jsonrpc: "2.0", method: SHORTCUTS_METHOD, params: { shortcuts, blocked } } as const;
}

export function htmlRenderResult(id: string | number) {
  return { jsonrpc: "2.0", id, result: {} } as const;
}

const THEME_FRAGMENT_KEY = "t3-theme";

export function htmlRenderThemeFragment(theme: HtmlRenderTheme): string {
  return `#${THEME_FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify(theme))}`;
}

export function htmlRenderThemeMessage(theme: HtmlRenderTheme) {
  return {
    jsonrpc: "2.0",
    method: HOST_CONTEXT_CHANGED_METHOD,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  } as const;
}

const BASE_CSS =
  "html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}" +
  "html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
  // Focus outlines paint inside the element, so the frame edge never clips them.
  ":where(:focus-visible){outline:2px solid var(--ring)}:focus-visible{outline-width:2px!important;outline-offset:-2px!important}" +
  ":where(img:not(a[href] img,button img)){cursor:zoom-in}";

function rootRule(theme: HtmlRenderTheme): string {
  const declarations = Object.entries(theme.variables)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `:root{color-scheme:${theme.appearance};${declarations}}`;
}

// Apply overridable theme CSS before paint and strip the fragment before routing; framed navigation uses the client.
// Forward shortcuts after page handlers; text fields retain their keys.
const BOOTSTRAP_SCRIPT = `(function(){var s=document.getElementById("t3-theme"),n=0;if(!s)return;var b=${JSON.stringify(BASE_CSS)};function a(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;var c=":root{color-scheme:"+(t.appearance==="light"?"light":"dark")+";";for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}s.textContent=c+"}"+b;}try{var m=/[#&]${THEME_FRAGMENT_KEY}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED_METHOD)}&&p&&p.styles)a({appearance:p.theme,variables:p.styles.variables});});document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;if(window.parent!==window){e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",id:"t3-link-"+(++n),method:${JSON.stringify(OPEN_LINK_METHOD)},params:{url:u.href,metaKey:e.metaKey,ctrlKey:e.ctrlKey}},"*");}else{l.setAttribute("target","_blank");l.setAttribute("rel","noopener");}},true);if(window.parent!==window){var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED_METHOD)},params:{height:v}},"*");};if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);window.addEventListener("click",function(e){var t=e.composedPath()[0],u;if(!e.isTrusted||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!t||t.tagName!=="IMG"||t.closest("a[href],button"))return;u=t.currentSrc||t.src;if(u)setTimeout(function(){if(!e.defaultPrevented)window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(OPEN_IMAGE_METHOD)},params:{src:u,name:t.alt||t.title||""}},"*");});});var K=[],B=[],C=${JSON.stringify(EVENT_CODE_SHORTCUT_KEYS)};window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(e.source===window.parent&&d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(SHORTCUTS_METHOD)}&&p&&Array.isArray(p.shortcuts)&&Array.isArray(p.blocked)){K=p.shortcuts;B=p.blocked;}});window.addEventListener("keydown",function(e){var t=e.composedPath()[0],c=e.code||"",l=e.key.toLowerCase(),x=/^[a-z]$/.test(l)?[l]:[l,/^Key[A-Z]$/.test(c)?c.slice(3).toLowerCase():"",C.hasOwnProperty(c)?C[c]:""],f,m=function(s){return s&&s.metaKey===e.metaKey&&s.ctrlKey===e.ctrlKey&&s.shiftKey===e.shiftKey&&s.altKey===e.altKey&&x.indexOf(s.key)>-1;};if(!e.isTrusted||e.isComposing||e.getModifierState("AltGraph")&&!/^[a-z0-9]$/i.test(e.key)||t&&(t.isContentEditable||/^(?:INPUT|TEXTAREA|SELECT)$/.test(t.tagName))||!K.some(m)||B.some(m))return;f=function(v){window.removeEventListener("keydown",f);if(v!==e||e.defaultPrevented)return;e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(KEY_DOWN_METHOD)},params:{key:e.key,code:e.code,metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,repeat:e.repeat}},"*");};window.addEventListener("keydown",f);setTimeout(function(){window.removeEventListener("keydown",f);});},true);}})();`;

// Answers a commenting reader with the element under the picked point: its CSS path (local names
// with case kept so SVG's clipPath matches; ids; :nth-of-type; none past 512 chars, since a cut
// path names another element), text and page-coordinate box. Also re-finds saved selectors and,
// once asked, reports scroll and size changes at most once a frame. Only the parent may ask.
const COMMENT_ANCHOR_SCRIPT = `(function(){if(window.parent===window)return;var D=document,R=D.documentElement,W=0,F=0,P=window.parent;function p(e){var s=[],n=e,t,k,i,c,j,q,x=0;while(n&&n.nodeType===1&&n!==D.body&&n!==R){t=n.localName;k=n.parentElement?n.parentElement.children:[];i=1;c=0;if(n.id&&/^[A-Za-z][\\w-]*$/.test(n.id)){s.unshift(t+"#"+n.id);x=1;break;}for(j=0;j<k.length;j++)if(k[j].tagName===n.tagName){c++;if(k[j]===n)i=c;}s.unshift(c>1?t+":nth-of-type("+i+")":t);n=n.parentElement;}if(!s.length||!x&&n!==D.body)return "";q=(x?"":"body > ")+s.join(" > ");return q.length>${COMMENT_SELECTOR_MAX_CHARS}?"":q;}function g(o){o.page={width:R.scrollWidth,height:R.scrollHeight};o.scroll={x:window.scrollX,y:window.scrollY};return o;}function r(el){var b=el.getBoundingClientRect();return{x:b.left+window.scrollX,y:b.top+window.scrollY,width:b.width,height:b.height};}function x(el){return String(el.innerText||el.textContent||"").replace(/\\s+/g," ").trim().slice(0,${COMMENT_ANCHOR_TEXT_MAX_CHARS});}function v(){if(F)return;F=requestAnimationFrame(function(){F=0;P.postMessage({jsonrpc:"2.0",method:${JSON.stringify(COMMENT_VIEW_METHOD)},params:g({})},"*");});}window.addEventListener("message",function(e){var d=e.data,q=d&&d.params,a,b,el,o;if(e.source!==P||!d||d.jsonrpc!=="2.0"||!q)return;if(d.method===${JSON.stringify(COMMENT_SCROLL_REQUEST_METHOD)}){window.scrollBy(+q.x||0,+q.y||0);return;}if(typeof q.requestId!=="string")return;if(d.method===${JSON.stringify(COMMENT_RESOLVE_REQUEST_METHOD)}&&Array.isArray(q.selectors)){o=g({requestId:q.requestId,anchors:q.selectors.slice(0,${COMMENT_RESOLVE_SELECTORS_MAX}).map(function(s){try{el=typeof s==="string"?D.querySelector(s):null;}catch(z){el=null;}return el?{rect:r(el),text:x(el)}:null;})});P.postMessage({jsonrpc:"2.0",method:${JSON.stringify(COMMENT_RESOLVE_METHOD)},params:o},"*");if(!W){W=1;window.addEventListener("scroll",v,{passive:true});if(window.ResizeObserver)new ResizeObserver(v).observe(R);}return;}if(d.method!==${JSON.stringify(COMMENT_ANCHOR_REQUEST_METHOD)})return;a=+q.x+(+q.width||0)/2;b=+q.y+(+q.height||0)/2;el=isFinite(a)&&isFinite(b)?D.elementFromPoint(a,b):null;o=g({requestId:q.requestId});if(el&&el!==D.body&&el!==R){o.selector=p(el);o.tagName=el.tagName;o.text=x(el);o.rect=r(el);}P.postMessage({jsonrpc:"2.0",method:${JSON.stringify(COMMENT_ANCHOR_METHOD)},params:o},"*");});})();`;

function bootstrapMarkup(markup: string): string {
  const dark = htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark");
  const light = htmlRenderTheme(T3_CODE_LIGHT_THEME_COLORS, "light");
  const defaultCss = `${rootRule(dark)}@media (prefers-color-scheme: light){${rootRule(light)}}${BASE_CSS}`;
  return [
    /<meta\s[^>]*charset/i.test(markup.slice(0, 4096)) ? "" : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(markup)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="t3-theme">${defaultCss}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
    `<script>${COMMENT_ANCHOR_SCRIPT}</script>`,
  ].join("");
}

// Blank inert content without shifting offsets so it cannot receive the bootstrap.
const blankNonMarkup = (html: string) => {
  const scan = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (match) => " ".repeat(match.length),
  );
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let at = 0;
  for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!match[1]) {
      if (depth++ === 0) start = match.index;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + match[0].length;
      parts.push(scan.slice(at, start), " ".repeat(end - start));
      at = end;
    }
  }
  if (depth > 0) {
    parts.push(scan.slice(at, start), " ".repeat(scan.length - start));
    at = scan.length;
  }
  parts.push(scan.slice(at));
  return parts.join("");
};

function injectHeadMarkup(
  html: string,
  markupFor: (scan: string) => string,
  // A file the author wrote without a doctype renders in quirks mode, and must keep doing so.
  addDoctype: boolean,
): string {
  const scan = blankNonMarkup(html);
  const markup = markupFor(scan);
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + markup + html.slice(at);
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  return `${addDoctype ? "<!doctype html>" : ""}<head>${markup}</head>${html}`;
}

export function injectHtmlRenderBootstrap(html: string): string {
  return injectHeadMarkup(html, bootstrapMarkup, true);
}

/**
 * Asset URLs for a workspace HTML file carry this query when the client wants
 * the page to answer comment-anchor requests. Only the reader's own client asks.
 */
export const HTML_FILE_COMMENT_ANCHORS_QUERY = "t3-page-comments";

/**
 * Adds only the comment-anchor script to a workspace HTML file, never the
 * visual-reply theme, so the page looks as its author wrote it. The script
 * answers only the frame's parent.
 */
export function injectHtmlFileCommentBootstrap(html: string): string {
  return injectHeadMarkup(html, () => `<script>${COMMENT_ANCHOR_SCRIPT}</script>`, false);
}
