import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  type LimitPace,
  limitsReadFromTurns,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

export type UsageTone = "normal" | "warning" | "critical";

const WARNING_USED_PERCENT = 75;
const CRITICAL_USED_PERCENT = 90;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MODEL_SCOPED_ID_PREFIX = "seven_day_";
const MODEL_LABEL_SEPARATOR = " · ";

export interface UsageWindowReading {
  readonly remainingPercent: number;
  /** Where the remaining bar would sit at an even spend rate. */
  readonly paceRemainingPercent: number | null;
  readonly pace: LimitPace | null;
  readonly resetsAt: number | null;
  readonly tone: UsageTone;
}

export type UsageRow =
  | { readonly kind: "session"; readonly reading: UsageWindowReading }
  | { readonly kind: "weekly"; readonly reading: UsageWindowReading }
  | { readonly kind: "monthly"; readonly reading: UsageWindowReading }
  | { readonly kind: "model"; readonly model: string; readonly reading: UsageWindowReading };

export type ResetCountdown =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "hours"; readonly hours: number; readonly minutes: number }
  | { readonly kind: "days"; readonly days: number; readonly hours: number };

export type SidebarUsageProvider = "claude" | "codex";

export interface SidebarUsageGroup {
  readonly provider: SidebarUsageProvider;
  readonly rows: ReadonlyArray<UsageRow>;
  readonly readFromTurns: boolean;
}

type UsageLimitsProvider = Pick<ServerProvider, "driver" | "enabled" | "usageLimits">;

const DRIVER: Record<SidebarUsageProvider, string> = { claude: "claudeAgent", codex: "codex" };
// Codex's main allowance positions; its monthly credit limit stays on the Usage page.
const CODEX_WINDOW_IDS: ReadonlySet<string> = new Set(["primary", "secondary"]);
const CODEX_ROW_ORDER = ["session", "weekly", "monthly"] as const;

export function usageTone(usedPercent: number): UsageTone {
  if (usedPercent >= CRITICAL_USED_PERCENT) return "critical";
  if (usedPercent >= WARNING_USED_PERCENT) return "warning";
  return "normal";
}

function readWindow(window: ServerProviderUsageWindow, now: number): UsageWindowReading {
  const parsed = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  const resetsAt = Number.isFinite(parsed) ? parsed : null;
  // A window past its reset has refilled; the provider reports the new window on the next turn.
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
    tone: usageTone(100 - remaining),
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

function readableLimits(
  provider: UsageLimitsProvider | null | undefined,
  kind: SidebarUsageProvider,
) {
  if (!provider || provider.driver !== DRIVER[kind] || !provider.enabled) return null;
  const limits = provider.usageLimits;
  // A failed probe still shows windows streamed from turns: those come straight from the provider.
  if (!limits || limits.unavailable?.reason === "unsupported") return null;
  return limits;
}

export function resolveClaudeUsageRows(
  provider: UsageLimitsProvider | null | undefined,
  now: number,
): ReadonlyArray<UsageRow> | null {
  const limits = readableLimits(provider, "claude");
  if (!limits) return null;
  const rows: UsageRow[] = [];
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

/** Free and Go plans report a monthly window where paid plans have the 5-hour one. */
export function resolveCodexUsageRows(
  provider: UsageLimitsProvider | null | undefined,
  now: number,
): ReadonlyArray<UsageRow> | null {
  const limits = readableLimits(provider, "codex");
  if (!limits) return null;
  const rows: UsageRow[] = [];
  for (const kind of CODEX_ROW_ORDER) {
    const window = limits.windows.find(
      (candidate) => CODEX_WINDOW_IDS.has(candidate.id) && candidate.kind === kind,
    );
    if (window) rows.push({ kind, reading: readWindow(window, now) });
  }
  // A monthly plan shows its one allowance, even if a weekly window also comes through.
  const monthly = rows.filter((row) => row.kind === "monthly");
  if (monthly.length > 0) return monthly;
  return rows.length > 0 ? rows : null;
}

const RESOLVE_ROWS = {
  claude: resolveClaudeUsageRows,
  codex: resolveCodexUsageRows,
} as const satisfies Record<SidebarUsageProvider, unknown>;

/**
 * Claude, then Codex: the first enabled instance of each with readable limits. Other instances
 * stay on the Usage page.
 */
export function resolveSidebarUsage(
  providers: ReadonlyArray<UsageLimitsProvider>,
  now: number,
): ReadonlyArray<SidebarUsageGroup> {
  const groups: SidebarUsageGroup[] = [];
  for (const kind of ["claude", "codex"] as const) {
    for (const provider of providers) {
      const rows = RESOLVE_ROWS[kind](provider, now);
      if (rows && provider.usageLimits) {
        groups.push({
          provider: kind,
          rows,
          readFromTurns: limitsReadFromTurns(provider.usageLimits),
        });
        break;
      }
    }
  }
  return groups;
}

/** Whether any provider could fill the sidebar, so the others skip the minute clock. */
export function hasSidebarUsageLimits(providers: ReadonlyArray<UsageLimitsProvider>): boolean {
  return providers.some(
    (provider) =>
      readableLimits(provider, "claude") !== null || readableLimits(provider, "codex") !== null,
  );
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
