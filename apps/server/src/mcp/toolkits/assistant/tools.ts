import {
  AssistantDraftLifecycle,
  AssistantDraftSection,
  AssistantDraftSource,
  AssistantDraftStatusValue,
  NonNegativeInt,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/ai/McpSchema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as AssistantService from "../../../assistant/AssistantService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  AssistantService.AssistantService,
];

const DraftItem = Schema.Struct({
  section: AssistantDraftSection,
  content: Schema.String.check(Schema.isPattern(/\S/u), Schema.isMaxLength(2000)),
  status: AssistantDraftStatusValue,
  project_id: Schema.optional(Schema.Int),
  project_other: Schema.optional(Schema.String.check(Schema.isMaxLength(255))),
  sort_order: NonNegativeInt,
});

const GetDailyReportDraftTool = Tool.make("assistant_get_daily_report_draft", {
  description:
    "Read the current daily report draft, including the user's edits on the card. Call it before revising the draft.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    /** Set when the draft is an earlier day's; tells the agent how to answer about today. */
    note: Schema.optional(Schema.String),
    report_date: Schema.String,
    status: AssistantDraftLifecycle,
    version: Schema.Int,
    items: Schema.Array(
      Schema.Struct({
        section: AssistantDraftSection,
        content: Schema.String,
        status: AssistantDraftStatusValue,
        project_id: Schema.NullOr(Schema.Int),
        project_other: Schema.NullOr(Schema.String),
        sort_order: Schema.Int,
      }),
    ),
    problem_text: Schema.String,
    sources: Schema.Array(AssistantDraftSource),
    edited_by_user: Schema.Boolean,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read daily report draft")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.assistantThreadOnly);

const ProposeDailyReportTool = Tool.make("assistant_propose_daily_report", {
  description:
    "Save a new version of the daily report draft; the user sees it as an editable card and submits it. Keep the user's edits from assistant_get_daily_report_draft and list every source you read in sources.",
  parameters: Schema.Struct({
    items: Schema.Array(DraftItem),
    problem_text: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
    sources: Schema.Array(AssistantDraftSource).check(Schema.isMinLength(1)),
  }),
  success: Schema.Struct({
    dailyReportDraft: Schema.Struct({ reportDate: Schema.String, version: Schema.Int }),
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Propose daily report")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.assistantThreadOnly);

export const AssistantToolkit = Toolkit.make(GetDailyReportDraftTool, ProposeDailyReportTool);
