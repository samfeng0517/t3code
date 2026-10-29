import { useT } from "~/i18n";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ContextWindowDetails, formatContextWindowPercentage } from "./ContextWindowMeter";
import { type ContextWindowTone, contextWindowTone } from "./ContextWindowMeter.logic";
import { THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS } from "./threadDetailsPanelStyles";

// Same bar treatment as the sidebar usage footer, coloured by distance to auto-compaction.
const BAR_COLOR = {
  normal: "var(--muted-foreground)",
  warning: "var(--warning)",
  critical: "var(--destructive)",
} as const satisfies Record<ContextWindowTone, string>;

export function ThreadDetailsContextRow(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage } = props;
  const t = useT();
  const maxTokens = usage.maxTokens ?? null;
  const percent = maxTokens !== null ? formatContextWindowPercentage(usage.usedPercentage) : null;
  const usedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const color = BAR_COLOR[contextWindowTone(usage)];
  const tokens =
    maxTokens !== null
      ? `${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(maxTokens)}`
      : formatContextWindowTokens(usage.usedTokens);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={props.onCompact ? 150 : 0}
        render={
          <button
            type="button"
            className={cn(
              "flex w-full flex-col gap-1 rounded-lg py-1.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]",
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
            )}
          />
        }
      >
        <span className="flex w-full items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
          <span className="truncate">{t("composer.contextWindow.panelLabel")}</span>
          <span className="shrink-0 whitespace-nowrap font-medium text-foreground/80">
            {percent ? `${percent} · ${tokens}` : tokens}
          </span>
        </span>
        {maxTokens !== null ? (
          // Buttons flatten their children for assistive tech; the label above already reads out usage.
          <span
            aria-hidden
            className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/10"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full opacity-60"
              style={{ width: `${usedPercentage}%`, backgroundColor: color }}
            />
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="left"
        align="start"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        <ContextWindowDetails
          usage={usage}
          modelDisplayName={props.modelDisplayName}
          onCompact={props.onCompact}
          compactDisabled={props.compactDisabled}
          compactDisabledReason={props.compactDisabledReason}
        />
      </PopoverPopup>
    </Popover>
  );
}
