import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { type Translate, useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { primaryServerProvidersAtom } from "~/state/server";
import { useSidebar } from "../ui/sidebar";
import { requestUsagePageMetric } from "../usage/usagePagePreferences";
import {
  type ClaudeUsageRow,
  type ClaudeUsageTone,
  resetCountdown,
  resolveSidebarClaudeUsage,
} from "./SidebarClaudeUsage.logic";

const BAR_FILL = {
  normal: "bg-muted-foreground/60",
  warning: "bg-warning",
  critical: "bg-destructive",
} as const satisfies Record<ClaudeUsageTone, string>;

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

function UsageRow(props: { readonly row: ClaudeUsageRow; readonly now: number }) {
  const t = useT();
  const { reading } = props.row;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="truncate">{rowLabel(t, props.row)}</span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="font-medium text-sidebar-foreground">{reading.usedPercent}%</span>
          {reading.resetsAt !== null
            ? ` · ${t("sidebar.usage.resetsIn", {
                duration: formatCountdown(t, reading.resetsAt, props.now),
              })}`
            : null}
        </span>
      </div>
      <div className="h-0.75 overflow-hidden rounded-full bg-sidebar-foreground/10">
        <div
          className={cn("h-full rounded-full", BAR_FILL[reading.tone])}
          style={{ width: `${reading.usedPercent}%` }}
        />
      </div>
    </div>
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

  const openLimits = () => {
    if (isMobile) setOpenMobile(false);
    requestUsagePageMetric("limits");
    void navigate({ to: "/usage" });
  };

  return (
    <button
      type="button"
      onClick={openLimits}
      className="flex w-full flex-col gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer text-start outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset"
    >
      <span className="sr-only">{t("sidebar.usage.title")}</span>
      {rows.map((row) => (
        <UsageRow key={row.kind} row={row} now={now} />
      ))}
    </button>
  );
}
