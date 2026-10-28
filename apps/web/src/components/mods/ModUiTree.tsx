import {
  MOD_UI_VALUE_MAX_LENGTH,
  type ModSurfaceSite,
  type ModUiInput,
  type ModUiLink,
  type ModUiNode,
  type ModUiSelect,
  type ModUiSvg,
  type ModUiText,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import {
  clearAfterSubmit,
  createModActionQueue,
  hasModAutoFocus,
  isOpenableModLink,
  isTextEntryElement,
  modInputDraft,
  modSvgFrameDocument,
  modSvgFrameSize,
  modSvgImageSource,
  parseModSvg,
  modToneClassName,
  reconcileModInput,
  typeIntoModInput,
} from "./modsPanel.logic";
import type { ModActions } from "./useModActions";

// Marks a control the mod asked to take the focus; ModSite finds the first in tree order.
const AUTO_FOCUS_ATTRIBUTE = "data-mod-autofocus";
const autoFocusProps = (node: { readonly autoFocus?: true }) =>
  node.autoFocus === true ? { [AUTO_FOCUS_ATTRIBUTE]: "" } : {};

interface ModUiTreeProps {
  readonly node: ModUiNode;
  /** Where the tree is drawn: what each press, pick and edit names. */
  readonly site: ModSurfaceSite;
  readonly actions: ModActions;
}

function ModLink({ node }: { readonly node: ModUiLink }) {
  const label = node.label ?? node.href;
  if (!isOpenableModLink(node.href)) return <span>{label}</span>;
  return (
    <a
      href={node.href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}

function ModText({ node }: { readonly node: ModUiText }) {
  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-words",
        modToneClassName(node.tone),
        node.bold && "font-semibold",
        node.italic && "italic",
        node.underline && "underline",
        node.strikethrough && "line-through",
      )}
    >
      {node.children.map((child, index) =>
        typeof child === "string" ? (
          child
        ) : child.type === "link" ? (
          // A mod's runs carry no ids and are rebuilt whole on every redraw.
          // oxlint-disable-next-line react/no-array-index-key
          <ModLink key={index} node={child} />
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- runs carry no ids; see above.
          <ModText key={index} node={child} />
        ),
      )}
    </span>
  );
}

/**
 * The field keeps what the person types across redraws: a redraw changes it
 * only when the mod set a new value, not when it echoes the typing back. A
 * handled submit empties it, as Claude Code's own field does.
 */
function ModInput({ node, site, actions }: ModUiTreeProps & { readonly node: ModUiInput }) {
  const [draft, setDraft] = useState(() => modInputDraft(node.value));
  const [sending, setSending] = useState(false);
  const [queue] = useState(() => createModActionQueue(setSending));
  const current = reconcileModInput(draft, node.value, sending);
  if (current !== draft) setDraft(current);

  const change = (value: string) => {
    setDraft(typeIntoModInput(current, value));
    queue.push(() => actions.edit(site, node, "change", value), { collapsible: true });
  };
  const submit = () => {
    const text = current.text;
    queue.push(
      async () => {
        const result = await actions.edit(site, node, "submit", text);
        if (result._tag === "Success" && result.value.handled) {
          setDraft((latest) => clearAfterSubmit(latest, text));
        }
      },
      { collapsible: false },
    );
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Shift+Enter types a newline in a field of several rows, as in Claude Code.
    if (event.key !== "Enter" || event.shiftKey) return;
    // keyCode 229 is Safari's IME confirm, which reports no composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };
  const shared = {
    value: current.text,
    placeholder: node.placeholder,
    maxLength: MOD_UI_VALUE_MAX_LENGTH,
    disabled: !actions.canEdit,
    "aria-label": node.label ?? node.placeholder ?? node.key,
    onKeyDown,
    ...autoFocusProps(node),
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {node.label === undefined ? null : (
        <span className="text-muted-foreground text-xs">{node.label}</span>
      )}
      <div className="flex min-w-0 items-start gap-2">
        {node.rows === undefined ? (
          <Input
            {...shared}
            size="compact"
            onChange={(event) => change(event.currentTarget.value)}
          />
        ) : (
          <Textarea
            {...shared}
            size="sm"
            rows={node.rows}
            onChange={(event) => change(event.currentTarget.value)}
          />
        )}
        {node.submitLabel === undefined ? null : (
          <Button size="compact" variant="outline" disabled={!actions.canEdit} onClick={submit}>
            {node.submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Shows a pick at once, and the drawn value again if the pick did not reach the mod. */
function ModSelect({ node, site, actions }: ModUiTreeProps & { readonly node: ModUiSelect }) {
  const [picked, setPicked] = useState({ drawn: node.value, value: node.value });
  const current = picked.drawn === node.value ? picked : { drawn: node.value, value: node.value };
  if (current !== picked) setPicked(current);
  const selected = node.options.find((option) => option.value === current.value);

  const pick = async (value: string) => {
    setPicked({ drawn: node.value, value });
    const handled = await actions.pick(site, node, value);
    if (!handled) setPicked({ drawn: node.value, value: node.value });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {node.label === undefined ? null : (
        <span className="text-muted-foreground text-xs">{node.label}</span>
      )}
      <Select
        value={current.value ?? null}
        disabled={!actions.canAct}
        onValueChange={(value) => {
          if (typeof value === "string" && value !== current.value) void pick(value);
        }}
      >
        <SelectTrigger size="xs" aria-label={node.label ?? node.key} {...autoFocusProps(node)}>
          <SelectValue>
            {selected === undefined ? null : (selected.label ?? selected.value)}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {node.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label ?? option.value}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

/**
 * An interactive SVG draws in a frame sandboxed without scripts or same-origin
 * access, so hover styles and links inside it work while nothing in it can run
 * code or reach the app. Claude Code gives an Svg no handler, so nothing in the
 * frame is sent back to the mod.
 */
function ModSvgFrame({ node }: { readonly node: ModUiSvg }) {
  const parsed = parseModSvg(node.source);
  if (parsed === null) {
    return <span className="text-muted-foreground text-xs italic">{node.alt}</span>;
  }
  const size = modSvgFrameSize(node, parsed.intrinsic);
  return (
    <iframe
      title={node.alt}
      sandbox=""
      srcDoc={modSvgFrameDocument(parsed.markup)}
      referrerPolicy="no-referrer"
      // A frame whose color scheme differs from the page paints an opaque backdrop.
      style={{
        width: size.width,
        aspectRatio: `${size.width} / ${size.height}`,
        colorScheme: "normal",
      }}
      className="block h-auto max-w-full border-0"
    />
  );
}

function ModSvg({ node }: { readonly node: ModUiSvg }) {
  if (node.interactive === true) return <ModSvgFrame node={node} />;
  const source = modSvgImageSource(node.source);
  if (source === null) {
    return <span className="text-muted-foreground text-xs italic">{node.alt}</span>;
  }
  // A side the mod leaves out follows the image's own proportions; a pane
  // narrower than the width shrinks it, and the markup keeps its aspect inside.
  return (
    <img
      src={source}
      alt={node.alt}
      decoding="async"
      style={{ width: node.width, height: node.height }}
      className="max-w-full object-contain"
    />
  );
}

/** Draws a mod's element tree; every redraw replaces it whole. */
function ModUiTree({ node, site, actions }: ModUiTreeProps) {
  const t = useT();
  switch (node.type) {
    case "box":
      return (
        <div
          className={cn(
            "flex min-w-0 gap-2",
            node.direction === "column" ? "flex-col" : "flex-row flex-wrap items-center",
            node.bordered && "rounded-md border p-2",
          )}
        >
          {node.children.map((child, index) => (
            <ModUiTree
              // Mod trees carry no ids for boxes and text, and are replaced
              // whole; a keyed field keeps what the person typed across redraws.
              key={
                child.type === "button" || child.type === "input" || child.type === "select"
                  ? `${child.type}:${child.key}`
                  : index
              }
              node={child}
              site={site}
              actions={actions}
            />
          ))}
        </div>
      );
    case "text":
      return <ModText node={node} />;
    case "link":
      return <ModLink node={node} />;
    case "button":
      return (
        <Button
          size="compact"
          variant={node.variant === "primary" ? "default" : "outline"}
          disabled={!actions.canAct}
          onClick={() => void actions.press(site, node)}
          {...autoFocusProps(node)}
        >
          {node.label}
        </Button>
      );
    case "markdown":
      return <ChatMarkdown text={node.text} cwd={undefined} parseRawHtml={false} />;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
          <code>{node.source}</code>
        </pre>
      );
    case "input":
      return <ModInput node={node} site={site} actions={actions} />;
    case "select":
      return <ModSelect node={node} site={site} actions={actions} />;
    case "svg":
      return <ModSvg node={node} />;
    case "unsupported":
      return (
        <span className="text-muted-foreground text-xs italic">
          {t("mods.element.unsupported", { element: node.element })}
        </span>
      );
  }
}

/**
 * One site's drawing (a pane, or the band). The first control the mod marked `autoFocus` takes focus
 * once per site instance, the first time it is drawn while the site shows, as Claude Code does on mount.
 * It never takes the keyboard from a field the person is in elsewhere, nor moves focus already inside.
 */
export function ModSite({ visible, ...props }: ModUiTreeProps & { readonly visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFocusedRef = useRef(false);
  const autoFocus = hasModAutoFocus(props.node);

  // Runs after every commit, not on a dependency list: a control drawn disabled
  // (while a press is in flight, or without permission) waits for the redraw
  // that enables it, without spending the site's one autofocus.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses a DOM element imperatively after each commit, as the control may only be enabled by a later redraw
  useEffect(() => {
    const container = containerRef.current;
    if (!autoFocus || !visible || autoFocusedRef.current || container === null) return;
    const target = container.querySelector<HTMLElement>(`[${AUTO_FOCUS_ATTRIBUTE}]`);
    if (target === null || target.matches(":disabled")) return;
    autoFocusedRef.current = true;
    const active = document.activeElement;
    const busy =
      active !== null &&
      (container.contains(active) || (active instanceof HTMLElement && isTextEntryElement(active)));
    if (!busy) target.focus();
  });

  return (
    <div ref={containerRef} className="contents">
      <ModUiTree {...props} />
    </div>
  );
}
