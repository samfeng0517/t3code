import { useStableCallback } from "../../hooks/useStableCallback";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { DownloadIcon } from "lucide-react";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useRemoveClonedProject } from "../../hooks/useRemoveClonedProject";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useProjectClone } from "../../state/projectClones";
import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { dismissProjectFileCopy, useProjectFileCopy } from "../../lib/addProjectToMachine";
import { type ComposerBannerStackItem } from "./ComposerBannerStack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
/**
 * A project still being cloned or copied into place: the composer banner with its cancel,
 * retry, and remove actions, and the reason sending waits until it is done.
 */
export function useProjectCloneBanner(activeProjectRef: ScopedProjectRef | null) {
  const t = useT();
  const activeProjectClone = useProjectClone(activeProjectRef);
  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  const runProjectCloneAction = async (
    title: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<void> => {
    const result = await action();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : t("common.errorOccurred"),
        }),
      );
    }
  };
  const runProjectCloneActionStable = useStableCallback(runProjectCloneAction);
  const activeProjectFileCopy = useProjectFileCopy(activeProjectRef);
  const projectCloneSendBlockReason =
    activeProjectClone?.phase === "running"
      ? t("chatView.projectClone.cloningRepository")
      : activeProjectClone !== null && activeProjectClone.phase !== "done"
        ? t("chatView.projectClone.repositoryNotCloned")
        : activeProjectFileCopy?.phase === "copying"
          ? t("chatView.projectClone.copyingFiles")
          : null;
  const projectCloneBannerItem = (() => {
    if (activeProjectFileCopy?.phase === "failed" && activeProjectRef) {
      return {
        id: `project-file-copy:${activeProjectRef.projectId}`,
        variant: "error",
        icon: <DownloadIcon />,
        title: activeProjectFileCopy.title,
        description: activeProjectFileCopy.failures.join("\n"),
        onDismiss: () => dismissProjectFileCopy(activeProjectRef),
      };
    }
    if (!activeProjectClone || !activeProjectRef || activeProjectClone.phase === "done") {
      return null;
    }
    const name = projectCloneDisplayName(activeProjectClone);
    const { environmentId, projectId } = activeProjectRef;
    if (activeProjectClone.phase === "running") {
      return {
        id: `project-clone:${projectId}`,
        variant: "info",
        icon: <DownloadIcon />,
        title: t("chatView.projectClone.cloning", { name }),
        description: projectCloneProgressSummary(activeProjectClone),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable(t("chatView.projectClone.failedToCancel"), () =>
                cancelProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            {t("common.cancel")}
          </Button>
        ),
      };
    }
    const cancelled = activeProjectClone.phase === "cancelled";
    return {
      id: `project-clone:${projectId}`,
      variant: cancelled ? "warning" : "error",
      icon: <DownloadIcon />,
      title: cancelled
        ? t("chatView.projectClone.cancelled", { name })
        : t("chatView.projectClone.failed", { name }),
      description: cancelled ? t("chatView.projectClone.retryToBringIn") : activeProjectClone.error,
      actions: (
        <>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void removeClonedProject({ environmentId, projectId })}
          >
            {t("chatView.projectClone.removeProject")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable(t("chatView.projectClone.failedToRetry"), () =>
                retryProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            {t("chatView.common.retry")}
          </Button>
        </>
      ),
    };
  })() as ComposerBannerStackItem | null;
  return {
    projectCloneBannerItem,
    projectCloneSendBlockReason,
  };
}
