import type {
  AssistantDailyReportStatus,
  AssistantDraft,
  AssistantDraftItem,
  AssistantDraftSection,
  AssistantDraftSource,
} from "@t3tools/contracts";

export type DraftCardMode = "superseded" | "editable" | "readonly" | "submitted";

export function cardMode(input: {
  readonly version: number;
  readonly reportDate: string;
  readonly draft: AssistantDraft | null;
  readonly report: AssistantDailyReportStatus | null;
  readonly canOperate: boolean;
}): DraftCardMode {
  const { draft, report } = input;
  if (draft === null || draft.reportDate !== input.reportDate || draft.version !== input.version) {
    return "superseded";
  }
  if (
    draft.status === "submitted" ||
    (report?.reportDate === input.reportDate && report.submittedAt)
  ) {
    return "submitted";
  }
  return draft.status === "ready" && input.canOperate ? "editable" : "readonly";
}

/** `YYYY-MM-DD` as `MM/DD`. */
export function formatReportDate(reportDate: string): string {
  return `${reportDate.slice(5, 7)}/${reportDate.slice(8, 10)}`;
}

const SOURCE_ORDER = ["erp_prefill", "calendar", "t3_threads"] as const;

/** The card's source line reads in a fixed order, whatever order the assistant listed them in. */
export function orderedSources(
  sources: ReadonlyArray<AssistantDraftSource>,
): ReadonlyArray<AssistantDraftSource> {
  return SOURCE_ORDER.flatMap((key) => sources.filter((source) => source.key === key).slice(0, 1));
}

export const DRAFT_SECTIONS = [
  "yesterday",
  "today",
] as const satisfies ReadonlyArray<AssistantDraftSection>;

/** Renumbers `sortOrder` by position within each section, the only order the card keeps. */
export function withSectionOrder(
  items: ReadonlyArray<AssistantDraftItem>,
): ReadonlyArray<AssistantDraftItem> {
  const next = { yesterday: 0, today: 0 };
  return items.map((item) => ({ ...item, sortOrder: next[item.section]++ }));
}
