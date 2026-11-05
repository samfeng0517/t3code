import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, RunId, ThreadId } from "./baseSchemas.ts";

/** An ERP workday, `YYYY-MM-DD` in the ERP's own time zone. */
export const AssistantReportDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
export type AssistantReportDate = typeof AssistantReportDate.Type;

export const AssistantDraftSection = Schema.Literals(["yesterday", "today"]);
export type AssistantDraftSection = typeof AssistantDraftSection.Type;

export const AssistantDraftStatusValue = Schema.Literals([
  "new",
  "processing",
  "finished",
  "blocking",
]);
export type AssistantDraftStatusValue = typeof AssistantDraftStatusValue.Type;

export const AssistantDraftItem = Schema.Struct({
  section: AssistantDraftSection,
  content: Schema.String.check(Schema.isMaxLength(2000)),
  status: AssistantDraftStatusValue,
  projectId: Schema.NullOr(Schema.Int),
  projectOther: Schema.NullOr(Schema.String.check(Schema.isMaxLength(255))),
  sortOrder: NonNegativeInt,
});
export type AssistantDraftItem = typeof AssistantDraftItem.Type;

export const AssistantDraftSourceKey = Schema.Literals(["erp_prefill", "calendar", "t3_threads"]);
export type AssistantDraftSourceKey = typeof AssistantDraftSourceKey.Type;

export const AssistantDraftSource = Schema.Struct({
  key: AssistantDraftSourceKey,
  status: Schema.Literals(["ok", "partial", "failed"]),
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type AssistantDraftSource = typeof AssistantDraftSource.Type;

export const AssistantDraftFailure = Schema.Literals([
  "no-proposal",
  "run-failed",
  "thread-unavailable",
]);
export type AssistantDraftFailure = typeof AssistantDraftFailure.Type;

export const AssistantDraftLifecycle = Schema.Literals([
  "generating",
  "ready",
  "failed",
  "submitted",
]);
export type AssistantDraftLifecycle = typeof AssistantDraftLifecycle.Type;

export const AssistantDraft = Schema.Struct({
  reportDate: AssistantReportDate,
  status: AssistantDraftLifecycle,
  items: Schema.Array(AssistantDraftItem),
  problemText: Schema.String,
  /** Bumped on every write; saves and submits must name the revision they saw. */
  revision: NonNegativeInt,
  /** Bumped by each assistant proposal; cards older than it are read-only. */
  version: NonNegativeInt,
  sources: Schema.Array(AssistantDraftSource),
  failure: Schema.optional(AssistantDraftFailure),
  editedByUser: Schema.Boolean,
  triggerAttempt: NonNegativeInt,
  triggerRunId: Schema.optional(RunId),
  updatedAt: IsoDateTime,
  submittedAt: Schema.optional(IsoDateTime),
});
export type AssistantDraft = typeof AssistantDraft.Type;

export const AssistantClockSegment = Schema.Struct({
  start: IsoDateTime,
  end: Schema.NullOr(IsoDateTime),
  hours: Schema.Number,
});
export type AssistantClockSegment = typeof AssistantClockSegment.Type;

export const AssistantClockStatus = Schema.Struct({
  reportDate: AssistantReportDate,
  serverNow: IsoDateTime,
  segments: Schema.Array(AssistantClockSegment),
  activeStart: Schema.NullOr(IsoDateTime),
  completedHours: Schema.Number,
  requiredHours: Schema.Number,
  expectedEnd: Schema.NullOr(IsoDateTime),
});
export type AssistantClockStatus = typeof AssistantClockStatus.Type;

export const AssistantDailyReportStatus = Schema.Struct({
  reportDate: AssistantReportDate,
  exempt: Schema.Boolean,
  submittedAt: Schema.NullOr(IsoDateTime),
  erpDailyReportUrl: Schema.String,
});
export type AssistantDailyReportStatus = typeof AssistantDailyReportStatus.Type;

export const AssistantProject = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
});
export type AssistantProject = typeof AssistantProject.Type;

export const AssistantState = Schema.Struct({
  assistantThreadId: Schema.NullOr(ThreadId),
  /** Newest report date first. */
  drafts: Schema.Array(AssistantDraft),
});
export type AssistantState = typeof AssistantState.Type;

export const AssistantErrorReason = Schema.Literals([
  "not-configured",
  "unauthorized",
  "suspended",
  "missing-scope",
  "rejected",
  "unavailable",
  "stale-revision",
  "not-editable",
  "busy",
  "submitted",
  "no-draft",
  "thread-unavailable",
  "memory-io",
]);
export type AssistantErrorReason = typeof AssistantErrorReason.Type;

export class AssistantError extends Schema.TaggedError<AssistantError>()("AssistantError", {
  reason: AssistantErrorReason,
  /** The ERP's own message, shown verbatim; never carries the token. */
  erpMessage: Schema.optional(Schema.String),
  requiredScopes: Schema.optional(Schema.Array(Schema.String)),
}) {}

export const AssistantSaveDraftInput = Schema.Struct({
  reportDate: AssistantReportDate,
  revision: NonNegativeInt,
  items: Schema.Array(AssistantDraftItem),
  problemText: Schema.String,
});
export type AssistantSaveDraftInput = typeof AssistantSaveDraftInput.Type;

/** Regenerate and submit act on the revision the user saw. */
export const AssistantDraftRefInput = Schema.Struct({
  reportDate: AssistantReportDate,
  revision: NonNegativeInt,
});
export type AssistantDraftRefInput = typeof AssistantDraftRefInput.Type;

export const AssistantMemory = Schema.Struct({
  content: Schema.String.check(Schema.isMaxLength(64 * 1024)),
});
export type AssistantMemory = typeof AssistantMemory.Type;
