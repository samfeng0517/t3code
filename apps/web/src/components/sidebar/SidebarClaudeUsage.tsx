import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import type { LimitPace } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon, type LucideIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Fragment, memo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { type Translate, useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { primaryServerProvidersAtom } from "~/state/server";
import { SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePaceMark } from "../usage/UsageLimits";
import { requestUsagePageMetric } from "../usage/usagePagePreferences";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import {
  type ClaudeUsageRow,
  type ClaudeUsageTone,
  resetCountdown,
  resolveSidebarClaudeUsage,
} from "./SidebarClaudeUsage.logic";

// Mirrors the usage page bars: a translucent fill plus a hatch over the share that refills at reset.
const BAR_COLOR = {
  normal: PROVIDER_PRESENTATION.claude.color,
  warning: "var(--warning)",
  critical: "var(--destructive)",
} as const satisfies Record<ClaudeUsageTone, string>;

const PACE_ICON = {
  ahead: TrendingUpIcon,
  on: GaugeIcon,
  under: TrendingDownIcon,
} as const satisfies Record<LimitPace, LucideIcon>;

const PACE_LABEL = {
  ahead: "sidebar.usage.pace.ahead",
  on: "sidebar.usage.pace.on",
  under: "sidebar.usage.pace.under",
} as const satisfies Record<LimitPace, string>;

function formatCountdown(t: Translate, resetsAt: number, now: number): string {
  const countdown = resetCountdown(resetsAt, now);
  switch (countdown.kind) {
    case "days":
      return t("sidebar.usage.duration.days", { days: countdown.days, hours: countdown.hours });
    case "hours":
      return t("sidebar.usage.duration.hours", {
        hours: countdown.hours,
        minutes: countdown.minutes,
      });
    case "minutes":
      return t("sidebar.usage.duration.minutes", { minutes: countdown.minutes });
  }
}

function rowLabel(t: Translate, row: ClaudeUsageRow): string {
  switch (row.kind) {
    case "session":
      return t("sidebar.usage.session");
    case "weekly":
      return t("sidebar.usage.weekly");
    case "model":
      return t("sidebar.usage.model", { model: row.model });
  }
}

function UsageBar(props: { readonly reading: ClaudeUsageRow["reading"] }) {
  const { reading } = props;
  const [barRef, paceMark] = usePaceMark(reading.paceRemainingPercent);
  const color = BAR_COLOR[reading.tone];
  return (
    <div ref={barRef} className="relative h-3 min-w-0">
      <div className="absolute inset-0" style={paceMark?.gap}>
        <div className="absolute inset-x-0 inset-y-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
          {reading.remainingPercent > 0 ? (
            <div
              className="absolute inset-y-0 left-0 rounded-full opacity-35"
              style={{ width: `${reading.remainingPercent}%`, backgroundColor: color }}
            />
          ) : null}
          {reading.remainingPercent < 100 ? (
            <div
              className="absolute inset-y-0 right-0 opacity-30"
              style={{
                width: `${100 - reading.remainingPercent}%`,
                backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 4px)`,
              }}
            />
          ) : null}
        </div>
      </div>
      {paceMark ? (
        <span
          aria-hidden
          className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-sidebar-foreground"
          style={paceMark.tick}
        />
      ) : null}
    </div>
  );
}

function PaceMark(props: {
  readonly reading: ClaudeUsageRow["reading"];
  readonly tooltip: boolean;
}) {
  const t = useT();
  const { pace } = props.reading;
  if (!pace) return <span />;
  const PaceIcon = PACE_ICON[pace];
  const label = t(PACE_LABEL[pace]);
  const icon = (
    <span role="img" aria-label={label} className="inline-flex">
      <PaceIcon aria-hidden className={cn("size-3", pace === "ahead" && "text-warning")} />
    </span>
  );
  if (!props.tooltip) return icon;
  return (
    <Tooltip>
      <TooltipTrigger render={icon} />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** One line per window: label, bar with the pace tick, remaining percent, pace, and reset countdown. */
function UsageRows(props: {
  readonly rows: ReadonlyArray<ClaudeUsageRow>;
  readonly now: number;
  readonly fullLabels: boolean;
  readonly paceTooltips: boolean;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-[auto_minmax(2.5rem,1fr)_auto_auto_auto] items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
      {props.rows.map((row) => {
        const countdown =
          row.reading.resetsAt !== null
            ? formatCountdown(t, row.reading.resetsAt, props.now)
            : null;
        return (
          <Fragment key={row.kind}>
            <span className="truncate">
              {row.kind === "model" && !props.fullLabels ? row.model : rowLabel(t, row)}
            </span>
            <UsageBar reading={row.reading} />
            <span className="text-end font-medium text-sidebar-foreground">
              <span aria-hidden>{row.reading.remainingPercent}%</span>
              <span className="sr-only">
                {t("sidebar.usage.remaining", { percent: row.reading.remainingPercent })}
              </span>
            </span>
            <PaceMark reading={row.reading} tooltip={props.paceTooltips} />
            <span className="text-end text-2xs whitespace-nowrap">
              {countdown ? (
                <>
                  <span aria-hidden>↻ {countdown}</span>
                  <span className="sr-only">
                    {t("sidebar.usage.resetsIn", { duration: countdown })}
                  </span>
                </>
              ) : null}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

// Chip widths measured at text-xs: 126px whole, 98px without pace, 7px more per "100%".
// Indexed by how many readings show 100%, with 2px of slack.
const CHIP_PACE_HIDE_CLASS = [
  "@max-[128px]:hidden",
  "@max-[135px]:hidden",
  "@max-[142px]:hidden",
] as const;
const CHIP_LABEL_HIDE_CLASS = [
  "@max-[100px]:hidden",
  "@max-[107px]:hidden",
  "@max-[114px]:hidden",
] as const;

const CHIP_TONE_CLASS = {
  normal: "text-sidebar-foreground",
  warning: "text-warning",
  critical: "text-destructive",
} as const satisfies Record<ClaudeUsageTone, string>;

function hasClaudeUsageLimits(providers: ReadonlyArray<ServerProvider>): boolean {
  return providers.some((provider) => provider.driver === "claudeAgent" && provider.usageLimits);
}

function useOpenUsageLimits() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
    requestUsagePageMetric("limits");
    void navigate({ to: "/usage" });
  };
}

function useSidebarClaudeUsageReading(providers: ReadonlyArray<ServerProvider>) {
  // The shared minute clock keeps redraws to once a minute and adds no timer of its own.
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}Z`);
  return { now, usage: resolveSidebarClaudeUsage(providers, now) };
}

/**
 * Reads the primary environment's Claude limits snapshot, which the server already keeps
 * current from probes and mid-turn rate-limit events, so this adds no polling of its own.
 * Short windows show the toolbar chip instead.
 */
export const SidebarClaudeUsage = memo(function SidebarClaudeUsage() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  // Only an environment with a Claude instance subscribes to the minute clock.
  if (!hasClaudeUsageLimits(providers)) return null;
  return <SidebarClaudeUsageRows providers={providers} />;
});

function SidebarClaudeUsageRows(props: { readonly providers: ReadonlyArray<ServerProvider> }) {
  const t = useT();
  const openLimits = useOpenUsageLimits();
  const { now, usage } = useSidebarClaudeUsageReading(props.providers);
  if (!usage) return null;

  return (
    <button
      type="button"
      onClick={openLimits}
      className="hidden w-full rounded-lg px-2 py-1.5 cursor-pointer text-start outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset tall-window:block"
    >
      <span className="sr-only">{t("sidebar.usage.title")}</span>
      <UsageRows rows={usage.rows} now={now} fullLabels={false} paceTooltips />
      {usage.readFromTurns ? (
        <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">
          {t("sidebar.usage.readFromTurns")}
        </span>
      ) : null}
    </button>
  );
}

/** The compact form for short windows: 5-hour and weekly left in the toolbar, every window on hover. */
export const SidebarClaudeUsageChip = memo(function SidebarClaudeUsageChip() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  if (!hasClaudeUsageLimits(providers)) return null;
  return <SidebarClaudeUsageChipContent providers={providers} />;
});

function SidebarClaudeUsageChipContent(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const t = useT();
  const openLimits = useOpenUsageLimits();
  const { now, usage } = useSidebarClaudeUsageReading(props.providers);
  if (!usage) return null;
  const summaryRows = usage.rows.filter((row) => row.kind !== "model");
  if (summaryRows.length === 0) return null;
  const fullCount = summaryRows.filter((row) => row.reading.remainingPercent >= 100).length;

  return (
    // Takes the row's free space and drops pace, then labels, so it never pushes the update button out.
    <SidebarMenuItem
      // The undo notice gets the row until its fade-out unmounts it, so the chip returns in one step.
      className="@container flex min-w-0 flex-1 justify-end group-has-[[data-sidebar-undo-notice]]/utility:hidden tall-window:hidden"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={openLimits}
              className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-0.5 text-xs transition-opacity duration-200 ease-out starting:opacity-0 text-muted-foreground tabular-nums outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset"
            />
          }
        >
          <span className="sr-only">{t("sidebar.usage.title")}</span>
          {summaryRows.map((row) => (
            <span key={row.kind} className="flex items-center gap-0.5">
              <span className={CHIP_LABEL_HIDE_CLASS[fullCount]}>
                {t(
                  row.kind === "session"
                    ? "sidebar.usage.sessionShort"
                    : "sidebar.usage.weeklyShort",
                )}
              </span>
              <span className={cn("font-medium", CHIP_TONE_CLASS[row.reading.tone])}>
                <span aria-hidden>{row.reading.remainingPercent}%</span>
                <span className="sr-only">
                  {t("sidebar.usage.remaining", { percent: row.reading.remainingPercent })}
                </span>
              </span>
              <span className={cn("contents", CHIP_PACE_HIDE_CLASS[fullCount])}>
                <PaceMark reading={row.reading} tooltip={false} />
              </span>
            </span>
          ))}
        </TooltipTrigger>
        <TooltipPopup side="top">
          <div className="flex w-72 flex-col gap-1 p-1">
            <UsageRows rows={usage.rows} now={now} fullLabels paceTooltips={false} />
            {usage.readFromTurns ? (
              <span className="text-2xs leading-snug text-muted-foreground">
                {t("sidebar.usage.readFromTurns")}
              </span>
            ) : null}
          </div>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
