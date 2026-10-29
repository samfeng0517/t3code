import type { ServerProviderUsageWindow } from "@t3tools/contracts";

import type { MessageKey, Translate } from "~/i18n";
import { resetCountdown, type ResetCountdown } from "../sidebar/SidebarClaudeUsage.logic";

const MINUTE = 60_000;

const RESETS_IN_KEY = {
  full: "sidebar.usage.resetsIn",
  arrow: "usage.resets.arrow",
  inline: "usage.resets.inline",
} as const satisfies Record<string, MessageKey>;

export type UsageResetStyle = keyof typeof RESETS_IN_KEY;

function countdownText(t: Translate, countdown: ResetCountdown): string {
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

export function formatUsageDuration(t: Translate, ms: number): string {
  const remaining = Math.max(0, ms);
  if (remaining < MINUTE) return t("sidebar.usage.duration.minutes", { minutes: 0 });
  return countdownText(t, resetCountdown(remaining, 0));
}

/** The usage page's reset countdown, spelled out ("full"), as "↻ 2h" ("arrow") or as "in 2h" ("inline"). */
export function formatUsageResetsIn(
  t: Translate,
  window: ServerProviderUsageWindow,
  now: number,
  style: UsageResetStyle = "full",
): string | null {
  if (window.resetsAt === undefined) return null;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return null;
  if (resetsAt <= now) return t("usage.resets.now");
  if (resetsAt - now < MINUTE) return t("usage.resets.momentarily");
  return t(RESETS_IN_KEY[style], { duration: formatUsageDuration(t, resetsAt - now) });
}
