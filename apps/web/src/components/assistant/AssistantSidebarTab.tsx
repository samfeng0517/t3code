import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link, useLocation } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "../../i18n";
import { assistantEnvironment } from "../../state/assistant";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Badge } from "../ui/badge";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { formatDuration, msUntilNextMinute, sidebarTimer } from "./assistantClock.logic";

/** The assistant tab pinned above the project groups; the assistant lives on the primary environment only. */
export function AssistantSidebarTab() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <AssistantSidebarTabRow environmentId={environmentId} />;
}

function AssistantSidebarTabRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useT();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = useLocation({ select: (location) => location.pathname === "/assistant" });
  // startAssistantClockSync owns the reads; the tab only shows what the query holds.
  const status = AsyncResult.getOrElse(
    useAtomValue(assistantEnvironment.clockStatus({ environmentId, input: {} })),
    () => null,
  );
  const working = status !== null && status.activeStart !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks the open segment's worked time at each minute and on wake; nothing else repaints
  useEffect(() => {
    if (!working) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      const now = Date.now();
      setNowMs(now);
      timer = setTimeout(tick, msUntilNextMinute(now));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [working]);

  const timer = sidebarTimer(status, nowMs);
  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={active}
            render={<Link to="/assistant" />}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
          >
            <SparklesIcon />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {t("assistantPage.title")}
            </span>
            {timer === null ? null : (
              <span className="shrink-0 tabular-nums">
                <Badge size="sm" variant={timer.kind === "working" ? "success" : "secondary"}>
                  {t(
                    timer.kind === "working"
                      ? "assistantPage.sidebar.working"
                      : "assistantPage.sidebar.stopped",
                    { duration: formatDuration(timer.hours) },
                  )}
                </Badge>
              </span>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div aria-hidden className="mx-2 mt-2 border-t border-sidebar-border" />
    </SidebarGroup>
  );
}
