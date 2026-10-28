import type { FileDiffContentsLoader } from "@pierre/diffs";
import type { EnvironmentId, GitCommitFileDiffInput } from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { useT } from "~/i18n";
import { createGitDiffFileContentsLoader } from "~/lib/diffFileContents";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";

import { DiffPanelLoadingState } from "../DiffPanelShell";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

/** One file's change in a commit, in the same viewer as the thread diff panel. */
export function GitCommitDiff(props: {
  readonly environmentId: EnvironmentId;
  readonly input: GitCommitFileDiffInput;
}) {
  const t = useT();
  const { environmentId, input } = props;
  const resolvedTheme = useRenderedAppearance();
  const query = useEnvironmentQuery(gitEnvironment.commitFileDiff({ environmentId, input }));
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);

  // Switching file or commit keeps the last diff on screen until the next one arrives, paired
  // with the input it came from so expanding lines still reads that commit.
  const [shown, setShown] = useState(query.data === null ? null : { input, result: query.data });
  if (query.data !== null && query.data !== shown?.result) {
    setShown({ input, result: query.data });
  }
  const stale = query.data === null;

  const currentLoadDiffFiles =
    shown === null
      ? null
      : createGitDiffFileContentsLoader(getDiffFileContents, {
          environmentId,
          cwd: shown.input.cwd,
          sourceKind: "commit",
          baseRef: shown.input.baseRef,
          headRef: shown.input.headRef,
          cacheKey: `git-commit:${shown.input.baseRef}:${shown.input.headRef}`,
        });
  // The code view keeps one loader for its lifetime; a new identity would remount it.
  const loadDiffFiles: FileDiffContentsLoader = useStableCallback(async (fileDiff) => {
    if (currentLoadDiffFiles === null) {
      throw new Error("Diff file contents are unavailable for this selection.");
    }
    return currentLoadDiffFiles(fileDiff);
  });

  if (query.data === null && query.error !== null) {
    return (
      <Empty className="min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("git.detail.diffLoadFailed")}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={query.refresh}>
          {t("git.history.retry")}
        </Button>
      </Empty>
    );
  }
  if (shown === null) {
    return <DiffPanelLoadingState label={t("workspace.diff.loading.changes")} />;
  }

  const { result } = shown;
  const patch = getRenderablePatch(result.diff, `${result.diffHash}:${resolvedTheme}`);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", stale && "opacity-60")}>
      {result.truncated ? (
        <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-2xs text-muted-foreground">
          {t("git.detail.truncated")}
        </p>
      ) : null}
      {patch === null ? (
        <div className="flex flex-1 items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
          {t("workspace.diff.empty.noPatch")}
        </div>
      ) : patch.kind === "raw" ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <p className="mb-2 text-2xs text-muted-foreground/75">{patch.reason}</p>
          <pre className="font-mono text-2xs leading-relaxed text-muted-foreground/90">
            {patch.text}
          </pre>
        </div>
      ) : (
        <StyledDiffCodeView
          // A fresh viewer per file starts at its top instead of the previous file's offset.
          key={`${shown.input.headRef}:${shown.input.path}`}
          className="min-h-0 flex-1 overflow-auto"
          items={patch.files.map((fileDiff) => ({
            id: resolveFileDiffPath(fileDiff),
            type: "diff" as const,
            fileDiff,
          }))}
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
            loadDiffFiles,
          }}
        />
      )}
    </div>
  );
}
