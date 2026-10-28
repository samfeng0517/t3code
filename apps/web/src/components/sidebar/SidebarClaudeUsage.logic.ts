import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  type LimitPace,
  limitsNotice,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

export type ClaudeUsageTone = "normal" | "warning" | "critical";

const WARNING_USED_PERCENT = 75;
const CRITICAL_USED_PERCENT = 90;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MODEL_SCOPED_ID_PREFIX = "seven_day_";
const MODEL_LABEL_SEPARATOR = " · ";

export interface ClaudeUsageWindowReading {
  readonly remainingPercent: number;
  /** Where the remaining bar would sit at an even spend rate. */
  readonly paceRemainingPercent: number | null;
  readonly pace: LimitPace | null;
  readonly resetsAt: number | null;
  readonly tone: ClaudeUsageTone;
}

export type ClaudeUsageRow =
  | { readonly kind: "session"; readonly reading: ClaudeUsageWindowReading }
  | { readonly kind: "weekly"; readonly reading: ClaudeUsageWindowReading }
  | { readonly kind: "model"; readonly model: string; readonly reading: ClaudeUsageWindowReading };

export type ResetCountdown =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "hours"; readonly hours: number; readonly minutes: number }
  | { readonly kind: "days"; readonly days: number; readonly hours: number };

type ClaudeUsageProvider = Pick<ServerProvider, "driver" | "enabled" | "usageLimits">;

export function claudeUsageTone(usedPercent: number): ClaudeUsageTone {
  if (usedPercent >= CRITICAL_USED_PERCENT) return "critical";
  if (usedPercent >= WARNING_USED_PERCENT) return "warning";
  return "normal";
}

function readWindow(window: ServerProviderUsageWindow, now: number): ClaudeUsageWindowReading {
  const parsed = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  const resetsAt = Number.isFinite(parsed) ? parsed : null;
  // A window past its reset has refilled; Claude reports the new window on the next turn.
  if (resetsAt !== null && resetsAt <= now) {
    return {
      remainingPercent: 100,
      paceRemainingPercent: null,
      pace: null,
      resetsAt: null,
      tone: "normal",
    };
  }
  const remaining = remainingPercent(window);
  return {
    remainingPercent: remaining,
    paceRemainingPercent: paceRemainingPercent(window, now),
    pace: paceOf(window, now),
    resetsAt,
    tone: claudeUsageTone(100 - remaining),
  };
}

// The server labels model-scoped windows "Weekly · <display name>"; the display name is the
// only part worth showing since the row label is localized here.
function modelName(window: ServerProviderUsageWindow): string {
  const separator = window.label.lastIndexOf(MODEL_LABEL_SEPARATOR);
  return separator === -1
    ? window.label
    : window.label.slice(separator + MODEL_LABEL_SEPARATOR.length);
}

export function resolveClaudeUsageRows(
  provider: ClaudeUsageProvider | null | undefined,
  now: number,
): ReadonlyArray<ClaudeUsageRow> | null {
  if (!provider || provider.driver !== "claudeAgent" || !provider.enabled) return null;
  const limits = provider.usageLimits;
  if (!limits || limitsNotice(limits) !== null) return null;
  const rows: ClaudeUsageRow[] = [];
  const session = limits.windows.find((window) => window.id === "five_hour");
  if (session) rows.push({ kind: "session", reading: readWindow(session, now) });
  const weekly = limits.windows.find((window) => window.id === "seven_day");
  if (weekly) rows.push({ kind: "weekly", reading: readWindow(weekly, now) });
  // The CLI reports at most one model-scoped bucket today; keep the footer to one row for it.
  const scoped = limits.windows.find(
    (window) => window.kind === "weekly" && window.id.startsWith(MODEL_SCOPED_ID_PREFIX),
  );
  if (scoped) {
    rows.push({ kind: "model", model: modelName(scoped), reading: readWindow(scoped, now) });
  }
  return rows.length > 0 ? rows : null;
}

/** The first enabled Claude instance with readable limits; other instances stay on the Usage page. */
export function resolveSidebarClaudeUsage(
  providers: ReadonlyArray<ClaudeUsageProvider>,
  now: number,
): ReadonlyArray<ClaudeUsageRow> | null {
  for (const provider of providers) {
    const rows = resolveClaudeUsageRows(provider, now);
    if (rows) return rows;
  }
  return null;
}

/**
 * `now` is the start of the current minute, which already runs up to a minute behind, so
 * flooring never announces a reset early.
 */
export function resetCountdown(resetsAt: number, now: number): ResetCountdown {
  const remaining = Math.max(MINUTE, Math.floor((resetsAt - now) / MINUTE) * MINUTE);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) return { kind: "days", days, hours };
  if (hours > 0) return { kind: "hours", hours, minutes };
  return { kind: "minutes", minutes };
}
