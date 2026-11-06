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
import { ClaudeAI, type Icon, OpenAI } from "../Icons";
import { SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePaceMark } from "../usage/UsageLimits";
import { requestUsagePageMetric } from "../usage/usagePagePreferences";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import {
  hasSidebarUsageLimits,
  resetCountdown,
  resolveSidebarUsage,
  type SidebarUsageGroup,
  type SidebarUsageProvider,
  type UsageRow,
  type UsageTone,
} from "./SidebarUsageLimits.logic";

const PROVIDER_META = {
  claude: { name: "Claude", color: PROVIDER_PRESENTATION.claude.color, Icon: ClaudeAI },
  codex: { name: "Codex", color: PROVIDER_PRESENTATION.codex.color, Icon: OpenAI },
} as const satisfies Record<
  SidebarUsageProvider,
  { readonly name: string; readonly color: string; readonly Icon: Icon }
>;

// Mirrors the usage page bars: a translucent fill plus a hatch over the share that refills at reset.
function barColor(provider: SidebarUsageProvider, tone: UsageTone): string {
  if (tone === "warning") return "var(--warning)";
  if (tone === "critical") return "var(--destructive)";
  return PROVIDER_META[provider].color;
}

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

function rowLabel(t: Translate, row: UsageRow): string {
  switch (row.kind) {
    case "session":
      return t("sidebar.usage.session");
    case "weekly":
      return t("sidebar.usage.weekly");
    case "monthly":
      return t("sidebar.usage.monthly");
    case "model":
      return t("sidebar.usage.model", { model: row.model });
  }
}

function shortRowLabel(t: Translate, row: UsageRow): string {
  switch (row.kind) {
    case "session":
      return t("sidebar.usage.sessionShort");
    case "monthly":
      return t("sidebar.usage.monthlyShort");
    default:
      return t("sidebar.usage.weeklyShort");
  }
}

function UsageBar(props: { readonly reading: UsageRow["reading"]; readonly color: string }) {
  const { reading, color } = props;
  const [barRef, paceMark] = usePaceMark(reading.paceRemainingPercent);
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

function PaceMark(props: { readonly reading: UsageRow["reading"]; readonly tooltip: boolean }) {
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

/**
 * One line per window: label, bar with the pace tick, remaining percent, pace, and reset
 * countdown. Groups share one grid so their columns line up; a lone group gets no title.
 */
function usageTitle(t: Translate, groups: ReadonlyArray<SidebarUsageGroup>): string {
  const [only] = groups;
  return groups.length === 1 && only
    ? t("sidebar.usage.providerTitle", { provider: PROVIDER_META[only.provider].name })
    : t("sidebar.usage.title");
}

function UsageRows(props: {
  readonly groups: ReadonlyArray<SidebarUsageGroup>;
  readonly now: number;
  readonly fullLabels: boolean;
  readonly paceTooltips: boolean;
}) {
  const t = useT();
  const titled = props.groups.length > 1;
  return (
    <div className="grid grid-cols-[auto_minmax(2.5rem,1fr)_auto_auto_auto] items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
      {props.groups.map((group, index) => (
        <Fragment key={group.provider}>
          {titled ? (
            <span
              className={cn(
                "col-span-full text-2xs font-medium text-sidebar-foreground",
                index > 0 && "pt-1",
              )}
            >
              {PROVIDER_META[group.provider].name}
            </span>
          ) : null}
          {group.rows.map((row) => {
            const countdown =
              row.reading.resetsAt !== null
                ? formatCountdown(t, row.reading.resetsAt, props.now)
                : null;
            return (
              <Fragment key={row.kind}>
                <span className="truncate">
                  {row.kind === "model" && !props.fullLabels ? row.model : rowLabel(t, row)}
                </span>
                <UsageBar
                  reading={row.reading}
                  color={barColor(group.provider, row.reading.tone)}
                />
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
          {group.readFromTurns ? (
            <span className="col-span-full text-2xs leading-snug text-muted-foreground">
              {t("sidebar.usage.readFromTurns", { provider: PROVIDER_META[group.provider].name })}
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

// Chip widths measured at text-xs: a reading is 58px whole and 44px without pace, readings and
// provider icons (12px) sit 6px apart inside 4px of padding, and a "100%" or a "30d" label each
// add 7px. One provider shows no icon. Keyed by reading count, then indexed by those 7px extras,
// with 2px of slack.
const SINGLE_PACE_HIDE_CLASS: Record<number, ReadonlyArray<string>> = {
  1: ["@max-[64px]:hidden", "@max-[71px]:hidden", "@max-[78px]:hidden"],
  2: ["@max-[128px]:hidden", "@max-[135px]:hidden", "@max-[142px]:hidden"],
};
const SINGLE_LABEL_HIDE_CLASS: Record<number, ReadonlyArray<string>> = {
  1: ["@max-[50px]:hidden", "@max-[57px]:hidden", "@max-[64px]:hidden"],
  2: ["@max-[100px]:hidden", "@max-[107px]:hidden", "@max-[114px]:hidden"],
};
const PAIR_PACE_HIDE_CLASS: Record<number, ReadonlyArray<string>> = {
  2: ["@max-[164px]:hidden", "@max-[171px]:hidden", "@max-[178px]:hidden", "@max-[185px]:hidden"],
  3: [
    "@max-[228px]:hidden",
    "@max-[235px]:hidden",
    "@max-[242px]:hidden",
    "@max-[249px]:hidden",
    "@max-[256px]:hidden",
  ],
  4: [
    "@max-[292px]:hidden",
    "@max-[299px]:hidden",
    "@max-[306px]:hidden",
    "@max-[313px]:hidden",
    "@max-[320px]:hidden",
    "@max-[327px]:hidden",
  ],
};
const PAIR_LABEL_HIDE_CLASS: Record<number, ReadonlyArray<string>> = {
  2: ["@max-[136px]:hidden", "@max-[143px]:hidden", "@max-[150px]:hidden", "@max-[157px]:hidden"],
  3: [
    "@max-[186px]:hidden",
    "@max-[193px]:hidden",
    "@max-[200px]:hidden",
    "@max-[207px]:hidden",
    "@max-[214px]:hidden",
  ],
  4: [
    "@max-[236px]:hidden",
    "@max-[243px]:hidden",
    "@max-[250px]:hidden",
    "@max-[257px]:hidden",
    "@max-[264px]:hidden",
    "@max-[271px]:hidden",
  ],
};

// Two providers past their label step keep only each provider's first reading: without labels a
// reading is 27px, so this needs 36px + 33px per reading, plus the same 7px extras.
const PAIR_EXTRA_HIDE_CLASS: Record<number, ReadonlyArray<string>> = {
  3: [
    "@max-[135px]:hidden",
    "@max-[142px]:hidden",
    "@max-[149px]:hidden",
    "@max-[156px]:hidden",
    "@max-[163px]:hidden",
  ],
  4: [
    "@max-[168px]:hidden",
    "@max-[175px]:hidden",
    "@max-[182px]:hidden",
    "@max-[189px]:hidden",
    "@max-[196px]:hidden",
    "@max-[203px]:hidden",
  ],
};

function chipHideClasses(groups: ReadonlyArray<SidebarUsageGroup>) {
  const readings = groups.flatMap((group) => group.rows);
  const wide = readings.reduce(
    (count, row) =>
      count + (row.reading.remainingPercent >= 100 ? 1 : 0) + (row.kind === "monthly" ? 1 : 0),
    0,
  );
  const tables =
    groups.length > 1
      ? { pace: PAIR_PACE_HIDE_CLASS, label: PAIR_LABEL_HIDE_CLASS }
      : { pace: SINGLE_PACE_HIDE_CLASS, label: SINGLE_LABEL_HIDE_CLASS };
  const at = (classes: ReadonlyArray<string> | undefined) =>
    classes?.[Math.min(wide, classes.length - 1)] ?? "";
  return {
    pace: at(tables.pace[readings.length]),
    label: at(tables.label[readings.length]),
    extra: groups.length > 1 ? at(PAIR_EXTRA_HIDE_CLASS[readings.length]) : "",
  };
}

const CHIP_TONE_CLASS = {
  normal: "text-sidebar-foreground",
  warning: "text-warning",
  critical: "text-destructive",
} as const satisfies Record<UsageTone, string>;

function useOpenUsageLimits() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
    requestUsagePageMetric("limits");
    void navigate({ to: "/usage" });
  };
}

function useSidebarUsageReading(providers: ReadonlyArray<ServerProvider>) {
  // The shared minute clock keeps redraws to once a minute and adds no timer of its own.
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}Z`);
  return { now, groups: resolveSidebarUsage(providers, now) };
}

/**
 * Reads the primary environment's Claude and Codex limits snapshots, which the server already
 * keeps current from probes and mid-turn rate-limit events, so this adds no polling of its own.
 * Short windows show the toolbar chip instead.
 */
export const SidebarUsageLimits = memo(function SidebarUsageLimits() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  // Only an environment with a Claude or Codex instance subscribes to the minute clock.
  if (!hasSidebarUsageLimits(providers)) return null;
  return <SidebarUsageLimitsRows providers={providers} />;
});

function SidebarUsageLimitsRows(props: { readonly providers: ReadonlyArray<ServerProvider> }) {
  const t = useT();
  const openLimits = useOpenUsageLimits();
  const { now, groups } = useSidebarUsageReading(props.providers);
  if (groups.length === 0) return null;

  return (
    <button
      type="button"
      onClick={openLimits}
      className="hidden w-full rounded-lg px-2 py-1.5 cursor-pointer text-start outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset tall-window:block"
    >
      <span className="sr-only">{usageTitle(t, groups)}</span>
      <UsageRows groups={groups} now={now} fullLabels={false} paceTooltips />
    </button>
  );
}

/** The compact form for short windows: 5-hour and weekly left in the toolbar, every window on hover. */
export const SidebarUsageLimitsChip = memo(function SidebarUsageLimitsChip() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  if (!hasSidebarUsageLimits(providers)) return null;
  return <SidebarUsageLimitsChipContent providers={providers} />;
});

function SidebarUsageLimitsChipContent(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const t = useT();
  const openLimits = useOpenUsageLimits();
  const { now, groups } = useSidebarUsageReading(props.providers);
  const summaries = groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.kind !== "model") }))
    .filter((group) => group.rows.length > 0);
  if (summaries.length === 0) return null;
  const hide = chipHideClasses(summaries);
  const iconed = summaries.length > 1;

  return (
    // Takes the row's free space and drops pace, then labels, then a second provider's later
    // readings, so it never pushes the update button out.
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
          <span className="sr-only">{usageTitle(t, summaries)}</span>
          {summaries.map((group) => {
            const { Icon: ProviderIcon, name } = PROVIDER_META[group.provider];
            return (
              <span key={group.provider} className="contents">
                {iconed ? (
                  <span role="img" aria-label={name} className="inline-flex shrink-0">
                    <ProviderIcon aria-hidden className="size-3" />
                  </span>
                ) : null}
                {group.rows.map((row, index) => (
                  <span
                    key={row.kind}
                    className={cn("flex items-center gap-0.5", index > 0 && hide.extra)}
                  >
                    <span className={hide.label}>{shortRowLabel(t, row)}</span>
                    <span className={cn("font-medium", CHIP_TONE_CLASS[row.reading.tone])}>
                      <span aria-hidden>{row.reading.remainingPercent}%</span>
                      <span className="sr-only">
                        {t("sidebar.usage.remaining", { percent: row.reading.remainingPercent })}
                      </span>
                    </span>
                    <span className={cn("contents", hide.pace)}>
                      <PaceMark reading={row.reading} tooltip={false} />
                    </span>
                  </span>
                ))}
              </span>
            );
          })}
        </TooltipTrigger>
        <TooltipPopup side="top">
          <div className="flex w-72 flex-col gap-1 p-1">
            <UsageRows groups={groups} now={now} fullLabels paceTooltips={false} />
          </div>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
