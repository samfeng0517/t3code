import { TriangleAlertIcon } from "lucide-react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { useT } from "~/i18n";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

import { DiffPanelLoadingState } from "../DiffPanelShell";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { countPatchLines } from "./gitWorkingTreeState";
import type { GitWorkingTreeDiff as WorkingTreeDiff } from "./useGitWorkingTree";

/** The selected uncommitted file's diff, in the same viewer as a commit's file diff. */
export function GitWorkingTreeDiff(props: {
  readonly diff: WorkingTreeDiff | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const t = useT();
  const { diff } = props;
  const resolvedTheme = useRenderedAppearance();

  if (props.error !== null) {
    return (
      <Empty className="min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("git.detail.diffLoadFailed")}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          {t("git.history.retry")}
        </Button>
      </Empty>
    );
  }
  if (diff === null) {
    return props.loading ? (
      <DiffPanelLoadingState label={t("workspace.diff.loading.changes")} />
    ) : null;
  }

  const { input, result } = diff;
  const patch = getRenderablePatch(result.diff, `${result.diffHash}:${resolvedTheme}`);
  const counts = countPatchLines(result.diff);
  const area = t(
    input.area === "staged" ? "git.workingTree.areaStaged" : "git.workingTree.areaUnstaged",
  );

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", props.loading && "opacity-60")}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {t("git.workingTree.diffHeader", { path: input.path, area })}
        </span>
        <span className="shrink-0 text-right">{`+${counts.insertions} −${counts.deletions}`}</span>
      </div>
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
          key={`${input.area}:${input.path}`}
          className="min-h-0 flex-1 overflow-auto"
          items={patch.files.map((fileDiff) => ({
            id: resolveFileDiffPath(fileDiff),
            type: "diff" as const,
            fileDiff,
          }))}
          // No `loadDiffFiles`: the working tree has no fixed ref to read expanded context from.
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
          }}
        />
      )}
    </div>
  );
}
