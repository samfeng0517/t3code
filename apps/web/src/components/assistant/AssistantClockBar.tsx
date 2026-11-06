import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AssistantError,
  type AssistantClockStatus,
  type AssistantDailyReportStatus,
  type AssistantDraft,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useT, type Translate } from "~/i18n";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { assistantEnvironment } from "../../state/assistant";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  dailyChip,
  draftRejectionMessageKey,
  formatClockTime,
  formatDuration,
  remainingHours,
  workedHours,
  type DailyChipKind,
} from "./assistantClock.logic";
import { requestDraftReveal } from "./draftReveal";

const CONFIRM_CLOCK_OUT_MS = 3_000;
const isAssistantError = Schema.is(AssistantError);

const CHIP_VARIANT = {
  idle: "outline",
  generating: "info",
  ready: "warning",
  failed: "error",
  submitted: "success",
  exempt: "secondary",
} as const satisfies Record<DailyChipKind, string>;

export interface AssistantClockQuery {
  readonly data: AssistantClockStatus | null;
  readonly failure: unknown;
  readonly refresh: () => void;
}

/** What to tell the user about a failed ERP call, and where to send them. */
function describeAssistantFailure(
  error: unknown,
  t: Translate,
): { readonly message: string; readonly detail?: string; readonly fix: "settings" | "refresh" } {
  if (!isAssistantError(error)) {
    return { message: error instanceof Error ? error.message : String(error), fix: "refresh" };
  }
  switch (error.reason) {
    case "not-configured":
      return { message: t("assistantPage.error.notConfigured"), fix: "settings" };
    case "unauthorized":
    case "suspended":
      return { message: t("assistantPage.error.unauthorized"), fix: "settings" };
    case "missing-scope":
      return {
        message: t("assistantPage.error.missingScope", {
          scopes: (error.requiredScopes ?? []).join(t("assistantPage.error.scopeSeparator")),
        }),
        fix: "settings",
      };
    case "memory-io":
      return { message: t("assistantPage.memory.readFailed"), fix: "refresh" };
    default:
      return {
        message: t("assistantPage.error.unavailable"),
        ...(error.erpMessage === undefined ? {} : { detail: error.erpMessage }),
        fix: "refresh",
      };
  }
}

/** Toasts a failed command; an ERP rejection shows the ERP's own message verbatim. */
export function toastCommandFailure(
  result: AtomCommandResult<unknown, unknown>,
  t: Translate,
): unknown {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  if (isAssistantError(error) && error.reason === "rejected") {
    toastManager.add({
      type: "error",
      title: error.erpMessage ?? t("assistantPage.error.unavailable"),
    });
    return error;
  }
  const rejection = isAssistantError(error) ? draftRejectionMessageKey(error.reason) : null;
  if (rejection !== null) {
    toastManager.add({ type: "error", title: t(rejection) });
    return error;
  }
  const { message, detail } = describeAssistantFailure(error, t);
  toastManager.add({
    type: "error",
    title: message,
    ...(detail === undefined ? {} : { description: detail }),
  });
  return error;
}

function ClockFigure(props: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col leading-tight", props.className)}>
      <span className="text-xs text-muted-foreground">{props.label}</span>
      {props.children}
    </div>
  );
}

function ClockFigures(props: { readonly status: AssistantClockStatus; readonly nowMs: number }) {
  const t = useT();
  const { status, nowMs } = props;
  const worked = workedHours(status, nowMs);
  const progress = status.requiredHours > 0 ? Math.min(1, worked / status.requiredHours) : 0;
  return (
    <>
      {status.segments.map((segment, index) => (
        <ClockFigure
          key={segment.start}
          label={t("assistantPage.segment", { n: index + 1 })}
          className="hidden @2xl:flex"
        >
          {segment.end === null ? (
            <span className="text-sm text-success-foreground">
              {t("assistantPage.segment.open", { start: formatClockTime(segment.start) })}
            </span>
          ) : (
            <span className="text-sm">
              {formatClockTime(segment.start)}–{formatClockTime(segment.end)}
            </span>
          )}
        </ClockFigure>
      ))}
      <ClockFigure label={t("assistantPage.worked")}>
        <span className="text-sm">
          {formatDuration(worked)} / {formatDuration(status.requiredHours)}
        </span>
      </ClockFigure>
      <div className="hidden h-1.5 w-30 overflow-hidden rounded-full bg-muted @2xl:block">
        <div className="h-full bg-success" style={{ width: `${progress * 100}%` }} />
      </div>
      {status.activeStart !== null && status.expectedEnd !== null ? (
        <ClockFigure label={t("assistantPage.expectedEnd")}>
          <span className="text-base font-semibold">{formatClockTime(status.expectedEnd)}</span>
        </ClockFigure>
      ) : status.segments.length > 0 ? (
        <span className="text-sm">
          {t("assistantPage.remaining", {
            duration: formatDuration(remainingHours(status, nowMs)),
          })}
        </span>
      ) : null}
    </>
  );
}

function StatusError(props: { readonly failure: unknown; readonly onRefresh: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { message, detail, fix } = describeAssistantFailure(props.failure, t);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="text-sm text-destructive-foreground">{message}</span>
      {detail === undefined ? null : (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          fix === "settings" ? void navigate({ to: "/settings/assistant" }) : props.onRefresh()
        }
      >
        {fix === "settings" ? t("assistantPage.openSettings") : t("assistantPage.refresh")}
      </Button>
    </div>
  );
}

function DailyReportChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly clock: AssistantClockStatus | null;
  readonly report: AssistantDailyReportStatus | null;
  readonly draft: AssistantDraft | null;
}) {
  const t = useT();
  const { threadId, draft, report } = props;
  const chip = dailyChip({ clock: props.clock, report, draft });
  const status =
    chip.kind === "submitted" && chip.submittedAt !== undefined
      ? t("assistantPage.chip.submitted", { time: formatClockTime(chip.submittedAt) })
      : t(`assistantPage.chip.${chip.kind}`);
  return (
    <>
      <Badge
        size="default"
        variant={CHIP_VARIANT[chip.kind]}
        {...(threadId === null
          ? {}
          : {
              render: <button type="button" onClick={() => requestDraftReveal(threadId)} />,
            })}
      >
        {t("assistantPage.chip", { status })}
      </Badge>
      {chip.kind === "failed" && draft !== null ? (
        <>
          <span className="text-xs text-muted-foreground">
            {draft.failure === "no-proposal"
              ? t("assistantPage.draftFailure.noProposal")
              : t("assistantPage.draftFailure.runFailed")}
          </span>
          <DraftRetryButton environmentId={props.environmentId} draft={draft} />
          {report === null ? null : (
            <Button
              size="sm"
              variant="link"
              render={<a href={report.erpDailyReportUrl} target="_blank" rel="noreferrer" />}
            >
              {t("assistantPage.fillInErp")}
            </Button>
          )}
        </>
      ) : null}
    </>
  );
}

function DraftRetryButton(props: {
  readonly environmentId: EnvironmentId;
  readonly draft: AssistantDraft;
}) {
  const t = useT();
  const canOperate = useAtomValue(
    assistantEnvironment.regenerateDraft.permissionAtom(props.environmentId),
  );
  const regenerate = useAtomCommand(assistantEnvironment.regenerateDraft, {
    reportFailure: false,
  });
  const reloadState = useAtomRefresh(
    assistantEnvironment.state({ environmentId: props.environmentId, input: {} }),
  );
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const retry = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const result = await regenerate({
      environmentId: props.environmentId,
      input: { reportDate: props.draft.reportDate, revision: props.draft.revision },
    });
    inFlight.current = false;
    setPending(false);
    const error = toastCommandFailure(result, t);
    if (isAssistantError(error) && error.reason === "stale-revision") reloadState();
  };
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!canOperate || pending}
      onClick={() => void retry()}
    >
      {pending ? <Spinner /> : null}
      {t("assistantPage.retry")}
    </Button>
  );
}

function ClockButton(props: {
  readonly environmentId: EnvironmentId;
  readonly status: AssistantClockStatus;
  readonly onClocked: (status: AssistantClockStatus) => void;
  readonly onRefreshStatus: () => void;
}) {
  const t = useT();
  const open = props.status.activeStart !== null;
  const command = open ? assistantEnvironment.clockOut : assistantEnvironment.clockIn;
  const canOperate = useAtomValue(command.permissionAtom(props.environmentId));
  const clockIn = useAtomCommand(assistantEnvironment.clockIn, { reportFailure: false });
  const clockOut = useAtomCommand(assistantEnvironment.clockOut, { reportFailure: false });
  // State lags a fast double click by a render; the ref keeps it to one request.
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmRequested, setConfirmRequested] = useState(false);
  const confirming = open && confirmRequested;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the 停卡 confirmation expires on a wall-clock timer
  useEffect(() => {
    if (!confirmRequested) return;
    const timer = setTimeout(() => setConfirmRequested(false), CONFIRM_CLOCK_OUT_MS);
    return () => clearTimeout(timer);
  }, [confirmRequested]);

  const run = async (action: "in" | "out") => {
    inFlight.current = true;
    setPending(true);
    setConfirmRequested(false);
    const target = { environmentId: props.environmentId, input: {} };
    const result = await (action === "in" ? clockIn(target) : clockOut(target));
    inFlight.current = false;
    setPending(false);
    if (result._tag === "Success") props.onClocked(result.value);
    const error = toastCommandFailure(result, t);
    // An open segment the bar did not know about: show what ERP has now.
    if (action === "in" && isAssistantError(error) && error.reason === "rejected") {
      props.onRefreshStatus();
    }
  };

  const onClick = () => {
    if (inFlight.current) return;
    if (!open) void run("in");
    else if (!confirming) setConfirmRequested(true);
    else void run("out");
  };

  return (
    <Button
      size="sm"
      variant={!open ? "default" : confirming ? "destructive" : "destructive-outline"}
      disabled={!canOperate || pending}
      onClick={onClick}
    >
      {pending ? <Spinner /> : null}
      {!open
        ? t("assistantPage.clockIn")
        : confirming
          ? t("assistantPage.confirmClockOut")
          : t("assistantPage.clockOut")}
    </Button>
  );
}

/** The assistant page's top bar: today's clockings, the daily report chip and 打卡/停卡. */
export function AssistantClockBar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly clock: AssistantClockQuery;
  readonly report: AssistantDailyReportStatus | null;
  readonly draft: AssistantDraft | null;
}) {
  const t = useT();
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  const { clock } = props;
  // A clocking answers with the new status before the query's refetch lands; show it until then.
  const [clocked, setClocked] = useState<{
    readonly base: AssistantClockStatus | null;
    readonly next: AssistantClockStatus;
  } | null>(null);
  const status = clocked !== null && clocked.base === clock.data ? clocked.next : clock.data;
  return (
    <div className="@container shrink-0 border-b border-border bg-background">
      {/* The bar sits where the chat header's fixed panel controls and sidebar toggle are drawn. */}
      <div
        className={cn(
          // Room for up to four 32px panel toggles (maximize shows while the right panel is open),
          // plus the native window buttons on Windows and Linux desktop.
          "flex flex-wrap items-center gap-x-5 gap-y-2 py-2.5 pr-40 pl-5 tabular-nums wco:mr-(--workspace-native-controls-inset)",
          isElectron && "drag-region",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        <h1 className="hidden text-sm font-semibold @md:block">{t("assistantPage.title")}</h1>
        {clock.failure !== null ? (
          <StatusError failure={clock.failure} onRefresh={clock.refresh} />
        ) : status !== null ? (
          <ClockFigures status={status} nowMs={nowMs} />
        ) : null}
        {status === null ? null : (
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <DailyReportChip
              environmentId={props.environmentId}
              threadId={props.threadId}
              clock={status}
              report={props.report}
              draft={props.draft}
            />
            <ClockButton
              environmentId={props.environmentId}
              status={status}
              onClocked={(next) => setClocked({ base: clock.data, next })}
              onRefreshStatus={clock.refresh}
            />
          </div>
        )}
      </div>
    </div>
  );
}
