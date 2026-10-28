import {
  EnvironmentAuthorizationError,
  type EnvironmentId,
  type GitCommitDetailResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { LockIcon, TriangleAlertIcon } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useState } from "react";

import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { useClientSettings } from "~/hooks/useSettings";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { formatChatTimestampTooltip } from "~/timestampFormat";

import { DiffFileTree } from "../diffs/DiffFileTree";
import { diffFileTreeModel } from "../diffs/diffFileTree.logic";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { GitCommitDiff } from "./GitCommitDiff";
import { SHORT_HASH_LENGTH } from "./gitHistoryState";

const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

function MetaRow(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{props.label}</span>
      <span className="min-w-0 truncate font-mono text-foreground">{props.children}</span>
    </div>
  );
}

function splitMessage(message: string) {
  const newline = message.indexOf("\n");
  if (newline === -1) return { subject: message.trim(), body: "" };
  return { subject: message.slice(0, newline).trim(), body: message.slice(newline + 1).trim() };
}

function GitCommitDetailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-3 py-2.5">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  );
}

/** The selected commit's message, metadata, changed files and the selected file's diff. */
export function GitCommitDetail(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly hash: string;
  readonly headerAccessory?: ReactNode;
}) {
  const t = useT();
  const { environmentId, cwd, hash } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const query = useEnvironmentQuery(
    gitEnvironment.commitDetail({ environmentId, input: { cwd, hash } }),
  );
  const { width, handlers } = useResizableWidth({
    storageKey: "t3code:git-page:detail-width:v1",
    defaultWidth: 330,
    minWidth: 220,
    maxWidth: 560,
    edge: "right",
  });

  // A new selection keeps the previous commit on screen, dimmed, until its detail arrives.
  const [shown, setShown] = useState<GitCommitDetailResult | null>(query.data);
  if (query.data !== null && query.data !== shown) setShown(query.data);
  // A failed load replaces the dimmed previous commit, which would otherwise never clear.
  const failed = query.data === null && query.error !== null;
  const detail = failed ? null : (query.data ?? shown);
  const stale = query.data === null;

  const [selectedFile, setSelectedFile] = useState<{
    readonly hash: string;
    readonly path: string;
  } | null>(null);

  if (detail === null) {
    if (!failed) return <GitCommitDetailSkeleton />;
    // Commit detail needs `filesystem:read`, like the diff panel; retrying cannot grant it.
    if (isAuthorizationError(query.failure)) {
      return (
        <Empty className="min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon />
            </EmptyMedia>
            <EmptyTitle>{t("git.detail.noReadPermission")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <Empty className="min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("git.detail.loadFailed")}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={query.refresh}>
          {t("git.history.retry")}
        </Button>
      </Empty>
    );
  }

  const paths = detail.files.map((file) => file.path);
  const selectedPath =
    selectedFile !== null && selectedFile.hash === detail.hash && paths.includes(selectedFile.path)
      ? selectedFile.path
      : (paths[0] ?? null);
  const file = detail.files.find((entry) => entry.path === selectedPath) ?? null;
  const selectFile = (path: string) => setSelectedFile({ hash: detail.hash, path });

  // Arrow keys only move the tree's focus; on this page the focused file is the shown one.
  const selectFocusedFile = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = event.nativeEvent
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.hasAttribute("data-item-path"),
      );
    const modelPath = row?.getAttribute("data-item-path");
    if (!modelPath) return;
    const path = diffFileTreeModel(paths).selectionPath(modelPath);
    if (paths.includes(path)) selectFile(path);
  };

  const { subject, body } = splitMessage(detail.message);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1", stale && "opacity-60")}>
      <div
        className="relative flex shrink-0 flex-col border-r border-border"
        style={
          {
            [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
            width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
          } as CSSProperties
        }
      >
        <RightPanelResizeHandle handlers={handlers} className="left-auto -right-1" />
        <div className="flex max-h-1/2 shrink-0 flex-col gap-1 overflow-y-auto px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-semibold wrap-break-word">{subject}</h2>
            {props.headerAccessory}
          </div>
          {body.length > 0 ? (
            <p className="text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">
              {body}
            </p>
          ) : null}
          <MetaRow label={t("git.detail.author")}>
            {detail.authorName} &lt;{detail.authorEmail}&gt;
          </MetaRow>
          <MetaRow label={t("git.detail.date")}>
            {formatChatTimestampTooltip(
              new Date(detail.authoredAt * 1000).toISOString(),
              timestampFormat,
            )}
          </MetaRow>
          <div className="flex min-w-0 flex-wrap gap-x-3">
            <MetaRow label={t("git.detail.commit")}>
              {detail.hash.slice(0, SHORT_HASH_LENGTH)}
            </MetaRow>
            {detail.parents.length > 0 ? (
              <MetaRow label={t("git.detail.parent")}>
                {detail.parents.map((parent) => parent.slice(0, SHORT_HASH_LENGTH)).join(" ")}
              </MetaRow>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 border-t border-border" onKeyUp={selectFocusedFile}>
          <DiffFileTree
            ariaLabel={t("git.detail.files")}
            entries={detail.files.map((entry) => ({ path: entry.path, status: entry.status }))}
            selectedPath={selectedPath}
            onSelectFile={selectFile}
          />
        </div>
      </div>
      {file !== null ? (
        <GitCommitDiff
          environmentId={environmentId}
          input={{
            cwd,
            baseRef: detail.baseRef,
            headRef: detail.hash,
            path: file.path,
            previousPath: file.previousPath,
          }}
        />
      ) : null}
    </div>
  );
}
