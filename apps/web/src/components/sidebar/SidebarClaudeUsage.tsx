import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import type { LimitPace } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon, type LucideIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { memo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { type Translate, useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { primaryServerProvidersAtom } from "~/state/server";
import { useSidebar } from "../ui/sidebar";
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

function UsageRow(props: {
  readonly row: ClaudeUsageRow;
  readonly now: number;
  readonly first: boolean;
  readonly showCountdown: boolean;
}) {
  const t = useT();
  const { reading } = props.row;
  const [barRef, paceMark] = usePaceMark(reading.paceRemainingPercent);
  const PaceIcon = reading.pace ? PACE_ICON[reading.pace] : null;
  const paceLabel = reading.pace ? t(PACE_LABEL[reading.pace]) : null;
  const color = BAR_COLOR[reading.tone];
  const countdown =
    reading.resetsAt !== null ? formatCountdown(t, reading.resetsAt, props.now) : null;
  return (
    <>
      <div
        className={cn(
          "col-span-full flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums",
          !props.first && "mt-1.5",
        )}
      >
        <span className="truncate">{rowLabel(t, props.row)}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <span className="font-medium text-sidebar-foreground">
            {t("sidebar.usage.remaining", { percent: reading.remainingPercent })}
          </span>
          {PaceIcon && paceLabel ? (
            <Tooltip>
              <TooltipTrigger
                render={<span role="img" aria-label={paceLabel} className="inline-flex" />}
              >
                <PaceIcon aria-hidden className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{paceLabel}</TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      </div>
      <div ref={barRef} className="relative h-3 min-w-0">
        <div className="absolute inset-0" style={paceMark?.gap}>
          <div className="absolute inset-x-0 inset-y-0.5 overflow-hidden rounded-full bg-sidebar-foreground/10">
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
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-sidebar-foreground"
            style={paceMark.tick}
          />
        ) : null}
      </div>
      {props.showCountdown ? (
        <span className="text-end text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
          {countdown ? (
            <>
              <span aria-hidden>↻ {countdown}</span>
              <span className="sr-only">
                {t("sidebar.usage.resetsIn", { duration: countdown })}
              </span>
            </>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * Reads the primary environment's Claude limits snapshot, which the server already keeps
 * current from probes and mid-turn rate-limit events, so this adds no polling of its own.
 */
export const SidebarClaudeUsage = memo(function SidebarClaudeUsage() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  // Only an environment with a Claude instance subscribes to the minute clock.
  if (!providers.some((provider) => provider.driver === "claudeAgent" && provider.usageLimits)) {
    return null;
  }
  return <SidebarClaudeUsageRows providers={providers} />;
});

function SidebarClaudeUsageRows(props: { readonly providers: ReadonlyArray<ServerProvider> }) {
  const t = useT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  // The shared minute clock keeps redraws to once a minute and adds no timer of its own.
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}Z`);
  const rows = resolveSidebarClaudeUsage(props.providers, now);
  if (!rows) return null;
  const showCountdown = rows.some((row) => row.reading.resetsAt !== null);

  const openLimits = () => {
    if (isMobile) setOpenMobile(false);
    requestUsagePageMetric("limits");
    void navigate({ to: "/usage" });
  };

  return (
    <button
      type="button"
      onClick={openLimits}
      className={cn(
        "grid w-full items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 cursor-pointer text-start outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset",
        showCountdown ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1",
      )}
    >
      <span className="sr-only">{t("sidebar.usage.title")}</span>
      {rows.map((row, index) => (
        <UsageRow
          key={row.kind}
          row={row}
          now={now}
          first={index === 0}
          showCountdown={showCountdown}
        />
      ))}
    </button>
  );
}
