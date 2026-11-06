import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { Navigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import { useT } from "~/i18n";

import { assistantEnvironment, refreshSettled } from "../../state/assistant";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { expectsPrimaryEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { AssistantClockBar } from "./AssistantClockBar";

/** The assistant lives on the primary environment only. */
export function AssistantPage() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId !== null) return <AssistantPageContent environmentId={environmentId} />;
  // Primary discovery is async, so a reload here waits for it instead of leaving the page.
  if (expectsPrimaryEnvironment()) return <SidebarInset className="h-dvh" />;
  return <Navigate to="/" replace />;
}

function AssistantPageContent({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useT();
  const registry = useContext(RegistryContext);
  const clockAtom = assistantEnvironment.clockStatus({ environmentId, input: {} });
  const reportAtom = assistantEnvironment.dailyReport({ environmentId, input: {} });
  const clock = useEnvironmentQuery(clockAtom);
  const report = useEnvironmentQuery(reportAtom);
  const state = AsyncResult.getOrElse(
    useAtomValue(assistantEnvironment.state({ environmentId, input: {} })),
    () => null,
  );
  const canCreateThread = useAtomValue(
    assistantEnvironment.getOrCreateThread.permissionAtom(environmentId),
  );
  const getOrCreateThread = useAtomCommand(assistantEnvironment.getOrCreateThread, {
    reportFailure: false,
  });
  const threadRequested = useRef(false);
  const [threadFailed, setThreadFailed] = useState(false);
  const onThreadResult = (result: Awaited<ReturnType<typeof getOrCreateThread>>) => {
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    threadRequested.current = false;
    setThreadFailed(true);
  };
  const startThreadRequest = () => {
    threadRequested.current = true;
    void getOrCreateThread({ environmentId, input: {} }).then(onThreadResult);
  };
  const requestThread = useEffectEvent(() => {
    if (!threadRequested.current) startThreadRequest();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- entering the page re-reads ERP once (Spec: 進入助理頁)
  useEffect(() => {
    refreshSettled(registry, clockAtom);
    refreshSettled(registry, reportAtom);
  }, [registry, clockAtom, reportAtom]);

  const threadId = state?.assistantThreadId ?? null;
  const needsThread = state !== null && threadId === null && canCreateThread;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the server's assistant thread once; its id arrives on the state stream
  useEffect(() => {
    if (needsThread) requestThread();
  }, [needsThread]);

  const reportDate = clock.data?.reportDate;
  const draft = state?.drafts.find((entry) => entry.reportDate === reportDate) ?? null;
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      <AssistantClockBar
        environmentId={environmentId}
        threadId={threadId}
        clock={clock}
        report={report.data}
        draft={draft}
      />
      {threadId !== null ? (
        <ChatView
          key={threadId}
          environmentId={environmentId}
          threadId={threadId}
          routeKind="server"
        />
      ) : threadFailed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{t("assistantPage.draftRejected.threadUnavailable")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setThreadFailed(false);
              startThreadRequest();
            }}
          >
            {t("assistantPage.retry")}
          </Button>
        </div>
      ) : null}
    </SidebarInset>
  );
}
