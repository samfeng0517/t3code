import type {
  AssistantClockStatus,
  AssistantDailyReportStatus,
  AssistantDraft,
  AssistantErrorReason,
} from "@t3tools/contracts";

import type { MessageKey } from "~/i18n";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** `h:mm`, floored to the minute; ERP hours carry float noise such as 2.9833…. */
export function formatDuration(hours: number): string {
  const minutes = Math.max(0, Math.floor(hours * 60 + 1e-6));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Local 24-hour `HH:mm`. */
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function workedHours(status: AssistantClockStatus, nowMs: number): number {
  const open =
    status.activeStart === null ? 0 : Math.max(0, nowMs - Date.parse(status.activeStart)) / HOUR_MS;
  return status.completedHours + open;
}

export function remainingHours(status: AssistantClockStatus, nowMs: number): number {
  return Math.max(0, status.requiredHours - workedHours(status, nowMs));
}

export type DailyChipKind = "idle" | "generating" | "ready" | "failed" | "submitted" | "exempt";

export function dailyChip(input: {
  readonly clock: AssistantClockStatus | null;
  readonly report: AssistantDailyReportStatus | null;
  readonly draft: AssistantDraft | null;
}): { readonly kind: DailyChipKind; readonly submittedAt?: string } {
  const { clock, report, draft } = input;
  if (report?.exempt) return { kind: "exempt" };
  const submittedAt = report?.submittedAt ?? draft?.submittedAt;
  if (submittedAt) return { kind: "submitted", submittedAt };
  if (clock === null || clock.segments.length === 0) return { kind: "idle" };
  if (draft?.status === "generating" || draft?.status === "ready" || draft?.status === "failed") {
    return { kind: draft.status };
  }
  return { kind: "idle" };
}

export function sidebarTimer(
  status: AssistantClockStatus | null,
  nowMs: number,
): { readonly kind: "working" | "stopped"; readonly hours: number } | null {
  if (status === null || status.segments.length === 0) return null;
  return {
    kind: status.activeStart === null ? "stopped" : "working",
    hours: workedHours(status, nowMs),
  };
}

export function msUntilNextMinute(nowMs: number): number {
  return MINUTE_MS - (nowMs % MINUTE_MS);
}

/** Copy for a draft action (retry, save, submit) the server turned down; null for an ERP failure. */
export function draftRejectionMessageKey(reason: AssistantErrorReason): MessageKey | null {
  switch (reason) {
    case "busy":
      return "assistantPage.draftRejected.busy";
    case "stale-revision":
      return "assistantPage.draftRejected.staleRevision";
    case "submitted":
      return "assistantPage.draftRejected.submitted";
    case "not-editable":
      return "assistantPage.draftRejected.notEditable";
    case "no-draft":
      return "assistantPage.draftRejected.noDraft";
    case "thread-unavailable":
      return "assistantPage.draftRejected.threadUnavailable";
    default:
      return null;
  }
}
