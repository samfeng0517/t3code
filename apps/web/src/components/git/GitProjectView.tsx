import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  EllipsisIcon,
  FolderXIcon,
  GitCommitHorizontalIcon,
  PanelLeftIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  RESIZABLE_HEIGHT_RATIO_PROPERTY,
  type ResizableHeightHandlers,
  useResizableHeight,
} from "~/hooks/useResizableHeight";
import { useT } from "~/i18n";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";

import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Sheet, SheetPopup } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { GitCommitDetail } from "./GitCommitDetail";
import { GitGraphList, type GitGraphScrollTarget } from "./GitGraphList";
import { GitRefNameDialog } from "./GitRefNameDialog";
import { GitRefsSidebar } from "./GitRefsSidebar";
import type { GitMenuTarget } from "./gitContextMenus";
import { jumpFeedbackKey, planRefJump } from "./gitHistoryState";
import { GitToolbar } from "./GitToolbar";
import { useGitHistory } from "./useGitHistory";
import { useGitRefActions } from "./useGitRefActions";
import { useGitWriteActions } from "./useGitWriteActions";

const SPLIT_MIN_PX = 120;

const SKELETON_ROWS = Array.from({ length: 12 }, (_, index) => index);

function GitHistorySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2.5 px-3 py-2">
      {SKELETON_ROWS.map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton shape="pill" className="size-2.5 shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-18 shrink-0" />
          <Skeleton className="h-3 w-18 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function GitHistoryNotice(props: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <Empty className="min-h-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
      </EmptyHeader>
      {props.action}
    </Empty>
  );
}

function SplitResizeHandle(props: { readonly handlers: ResizableHeightHandlers }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      // Zero net height: it straddles the pane border without taking layout space.
      className="group relative z-20 -my-1 h-2 shrink-0 cursor-row-resize select-none"
      {...props.handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
      />
    </div>
  );
}

/** One project's repository: toolbar, refs sidebar, commit graph and commit detail. Mount one per Git tab. */
export function GitProjectView(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}) {
  const t = useT();
  const { environmentId, projectId, workspaceRoot } = props;
  const controller = useGitHistory({ environmentId, projectId, cwd: workspaceRoot });
  const { state, refs } = controller;
  const commits = state.commits;
  const repoRoot = refs?.repoRoot ?? null;
  const writes = useGitWriteActions({
    environmentId,
    projectId,
    repoRoot,
    refresh: controller.refresh,
  });
  const refActions = useGitRefActions({ environmentId, refs, writes });
  // Rows and sidebar items keep the first handler they get, so it must always see the latest state.
  const openMenu = useStableCallback(
    (target: GitMenuTarget, position: { x: number; y: number }) =>
      void refActions.openMenu(target, position),
  );
  // Passive: reads the cached ahead/behind without keeping a remote refresh loop alive.
  const status = useEnvironmentQuery(
    repoRoot === null
      ? null
      : vcsEnvironment.status({ environmentId, input: { cwd: repoRoot, includeRemote: false } }),
  ).data;

  // `undefined` until the first page picks the initial selection, so later reloads keep it.
  const [selectedHash, setSelectedHash] = useState<string | null | undefined>(undefined);
  const [scrollTarget, setScrollTarget] = useState<GitGraphScrollTarget | null>(null);
  const latestJump = useRef(0);
  const narrow = useMediaQuery("(max-width: 999px)");
  const [refsSheetOpen, setRefsSheetOpen] = useState(false);
  const split = useResizableHeight({
    storageKey: "t3code:git-page:graph-split:v1",
    defaultRatio: 0.535,
    minPx: SPLIT_MIN_PX,
  });

  const hashExists = (hash: string) =>
    commits.some((commit) => commit.hash === hash) ||
    (refs?.stashes.some((stash) => stash.hash === hash) ?? false);

  if (selectedHash === undefined && state.status === "ready") {
    const headHash = refs?.head.hash ?? null;
    const initial =
      headHash !== null && commits.some((commit) => commit.hash === headHash)
        ? headHash
        : (commits[0]?.hash ?? null);
    setSelectedHash(initial);
    if (initial !== null) setScrollTarget({ hash: initial });
  } else if (
    typeof selectedHash === "string" &&
    state.status !== "loading" &&
    !hashExists(selectedHash)
  ) {
    setSelectedHash(null);
  }

  const selectRow = (hash: string) => {
    latestJump.current += 1;
    setSelectedHash(hash);
  };

  const selectRef = async (hash: string, opts: { readonly select: boolean }) => {
    latestJump.current += 1;
    const jump = latestJump.current;
    const plan = planRefJump(refs?.stashes ?? [], hash, opts);
    if (plan === null) return;
    if (plan.selectNow !== null) setSelectedHash(plan.selectNow);
    const result = await controller.jumpTo(plan.scrollHash);
    // A later click or row selection superseded this jump.
    if (jump !== latestJump.current) return;
    const feedback = jumpFeedbackKey(result);
    if (feedback !== null) {
      toastManager.add({ type: result === "failed" ? "error" : "info", title: t(feedback) });
    }
    if (result !== "found") return;
    if (plan.selectOnFound !== null) setSelectedHash(plan.selectOnFound);
    setScrollTarget({ hash: plan.scrollHash });
  };

  const renderBody = () => {
    switch (state.status) {
      case "loading":
        return <GitHistorySkeleton />;
      case "not-repo":
        return <GitHistoryNotice icon={<FolderXIcon />} title={t("git.history.notRepo")} />;
      case "empty":
        return (
          <GitHistoryNotice icon={<GitCommitHorizontalIcon />} title={t("git.history.empty")} />
        );
      case "error":
        return (
          <GitHistoryNotice
            icon={<TriangleAlertIcon />}
            title={t("git.history.loadFailed")}
            action={
              <Button variant="outline" size="sm" onClick={controller.retry}>
                {t("git.history.retry")}
              </Button>
            }
          />
        );
      case "ready":
        return (
          <GitGraphList
            controller={controller}
            selectedHash={selectedHash ?? null}
            onSelect={selectRow}
            scrollTarget={scrollTarget}
            onOpenMenu={openMenu}
          />
        );
    }
  };

  const canRefresh = state.status !== "loading" && state.status !== "error";
  const showRefs = state.status === "ready" && refs !== null;
  const detailHash =
    state.status === "ready" && typeof selectedHash === "string" ? selectedHash : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GitToolbar
        refs={refs}
        status={status}
        onRefresh={canRefresh ? () => void controller.refresh() : null}
        writes={writes}
        leadingSlot={
          showRefs && narrow ? (
            <Button variant="outline" size="sm" onClick={() => setRefsSheetOpen(true)}>
              <PanelLeftIcon />
              {t("git.refs.show")}
            </Button>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-1">
        {showRefs && !narrow ? (
          <GitRefsSidebar
            refs={refs}
            onSelectRef={(hash, opts) => void selectRef(hash, opts)}
            onOpenMenu={openMenu}
          />
        ) : null}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          style={{ [RESIZABLE_HEIGHT_RATIO_PROPERTY]: split.ratio } as CSSProperties}
        >
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={
              detailHash === null
                ? { flex: "1 1 0" }
                : {
                    flex: `var(${RESIZABLE_HEIGHT_RATIO_PROPERTY}) 1 0`,
                    minHeight: SPLIT_MIN_PX,
                  }
            }
          >
            {renderBody()}
          </div>
          {detailHash !== null ? (
            <>
              <SplitResizeHandle handlers={split.handlers} />
              <div
                className="flex min-h-0 min-w-0 border-t border-border"
                style={{
                  flex: `calc(1 - var(${RESIZABLE_HEIGHT_RATIO_PROPERTY})) 1 0`,
                  minHeight: SPLIT_MIN_PX,
                }}
              >
                <GitCommitDetail
                  environmentId={environmentId}
                  cwd={workspaceRoot}
                  hash={detailHash}
                  headerAccessory={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("git.detail.moreActions")}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        openMenu(
                          { kind: "commit", hash: detailHash },
                          { x: rect.left, y: rect.bottom },
                        );
                      }}
                    >
                      <EllipsisIcon />
                    </Button>
                  }
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
      {showRefs && narrow ? (
        <Sheet open={refsSheetOpen} onOpenChange={setRefsSheetOpen}>
          <SheetPopup
            side="left"
            showCloseButton={false}
            className="w-auto"
            aria-label={t("git.refs.show")}
          >
            <GitRefsSidebar
              refs={refs}
              onSelectRef={(hash, opts) => {
                setRefsSheetOpen(false);
                void selectRef(hash, opts);
              }}
              onOpenMenu={openMenu}
            />
          </SheetPopup>
        </Sheet>
      ) : null}
      {refActions.namePrompt === null ? null : (
        <GitRefNameDialog
          request={refActions.namePrompt.request}
          pending={writes.pending !== null}
          onFinish={refActions.namePrompt.finish}
        />
      )}
    </div>
  );
}
