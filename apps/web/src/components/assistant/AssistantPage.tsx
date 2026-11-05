import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Navigate } from "@tanstack/react-router";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";
import { useContext, useEffect, useEffectEvent, useRef } from "react";

import { assistantEnvironment } from "../../state/assistant";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { expectsPrimaryEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatView from "../ChatView";
import { SidebarInset } from "../ui/sidebar";
import { AssistantClockBar } from "./AssistantClockBar";

/** Refetches a query that already settled; one still loading is fresh enough. */
function refreshSettled<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  const current = registry.get(atom);
  if (current._tag !== "Initial" && !current.waiting) registry.refresh(atom);
}

/** The assistant lives on the primary environment only. */
export function AssistantPage() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId !== null) return <AssistantPageContent environmentId={environmentId} />;
  // Primary discovery is async, so a reload here waits for it instead of leaving the page.
  if (expectsPrimaryEnvironment()) return <SidebarInset className="h-dvh" />;
  return <Navigate to="/" replace />;
}

function AssistantPageContent({ environmentId }: { readonly environmentId: EnvironmentId }) {
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
  const getOrCreateThread = useAtomCommand(assistantEnvironment.getOrCreateThread);
  const threadRequested = useRef(false);
  const requestThread = useEffectEvent(() => {
    if (threadRequested.current) return;
    threadRequested.current = true;
    void getOrCreateThread({ environmentId, input: {} });
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
      {threadId === null ? null : (
        <ChatView
          key={threadId}
          environmentId={environmentId}
          threadId={threadId}
          routeKind="server"
        />
      )}
    </SidebarInset>
  );
}
