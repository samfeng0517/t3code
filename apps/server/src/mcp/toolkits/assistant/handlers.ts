import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AssistantService from "../../../assistant/AssistantService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { AssistantToolkit } from "./tools.ts";

export const ASSISTANT_NO_TRIGGER_MESSAGE =
  "No daily report draft has been started for today. Drafting starts automatically after the user's first clock-in of the day. Tell the user: 草稿會在今天第一次打卡後自動擬";

export const proposedDraftMessage = (version: number) =>
  `Saved draft version ${version}. The user sees it as an editable card and submits it; do not repeat the items in chat.`;

/** Before today's first clock-in the newest draft is an earlier day's; "today" must not land on it. */
const earlierWorkdayNote = (reportDate: string) =>
  `This is the unsent draft for ${reportDate}, an earlier workday; today's draft has not started yet. If the user means today's daily report, do not change this draft. Tell the user: 草稿會在今天第一次打卡後自動擬`;

const toFailure = (error: AssistantService.AssistantAgentDraftError) => {
  switch (error.kind) {
    case "not-assistant-thread":
      return new OrchestratorMcpFailure({
        code: "capability_denied",
        message: "This tool is only available in the assistant thread.",
      });
    case "no-draft":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: ASSISTANT_NO_TRIGGER_MESSAGE,
      });
    case "submitted":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `The daily report for ${error.reportDate ?? "today"} was already submitted. Tell the user to edit it in ERP.`,
      });
    case "stale":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message:
          "The user changed the draft on the card after you last read it, so nothing was saved. Call assistant_get_daily_report_draft again, then propose your revision on top of the current draft.",
      });
    case "unread-earlier-workday":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `The newest draft is for ${error.reportDate ?? "an earlier day"}, an earlier workday, and you have not read it since the day changed or since your last change to it, so nothing was saved. Call assistant_get_daily_report_draft and follow its note before proposing.`,
      });
    case "unavailable":
      return new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "The daily report draft could not be read or saved. Tell the user to try again.",
      });
  }
};

/** The assistant thread's own agent: never an outside client or a delegated child. */
const assistantCaller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const thread = scope.thread;
  if (scope.client !== undefined || thread === undefined || thread.subagent === true) {
    return yield* toFailure(
      new AssistantService.AssistantAgentDraftError({ kind: "not-assistant-thread" }),
    );
  }
  return thread.threadId;
});

const handlers = {
  assistant_get_daily_report_draft: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const assistant = yield* AssistantService.AssistantService;
      const { draft, fromEarlierWorkday } = yield* assistant
        .getDraftForAgent(yield* assistantCaller)
        .pipe(Effect.mapError(toFailure));
      return {
        ...(fromEarlierWorkday ? { note: earlierWorkdayNote(draft.reportDate) } : {}),
        report_date: draft.reportDate,
        status: draft.status,
        version: draft.version,
        items: draft.items.map((item) => ({
          section: item.section,
          content: item.content,
          status: item.status,
          project_id: item.projectId,
          project_other: item.projectOther,
          sort_order: item.sortOrder,
        })),
        problem_text: draft.problemText,
        sources: draft.sources,
        edited_by_user: draft.editedByUser,
      };
    }),
  ),
  assistant_propose_daily_report: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const assistant = yield* AssistantService.AssistantService;
      const saved = yield* assistant
        .proposeDraft({
          callerThreadId: yield* assistantCaller,
          items: input.items.map((item) => ({
            section: item.section,
            content: item.content,
            status: item.status,
            projectId: item.project_id ?? null,
            projectOther: item.project_other ?? null,
            sortOrder: item.sort_order,
          })),
          problemText: input.problem_text ?? "",
          sources: input.sources,
        })
        .pipe(Effect.mapError(toFailure));
      return {
        dailyReportDraft: { reportDate: saved.reportDate, version: saved.version },
        message: saved.fromEarlierWorkday
          ? `${proposedDraftMessage(saved.version)} ${earlierWorkdayNote(saved.reportDate)}`
          : proposedDraftMessage(saved.version),
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof AssistantToolkit.tools>;

export const layer = McpToolAccess.toLayer(AssistantToolkit, handlers);
