import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { readProject, useQuietThreadShells } from "~/state/entities";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import { activeRootThreads, projectInRepoChecker } from "./gitActionGuards";

export type GitAgentWork = "checkout" | "discard" | "stash" | "applyStash";

/** Confirms for Git page writes, including the warning when an agent works in the repository. */
export function useGitConfirm(environmentId: EnvironmentId) {
  const t = useT();
  const threads = useQuietThreadShells();
  const historyRefsCommand = useAtomCommand(gitEnvironment.historyRefs, { reportFailure: false });

  const confirm = async (
    message: string,
    options?: { readonly destructive?: boolean; readonly confirmLabel?: string },
  ) => {
    const api = readLocalApi();
    if (!api) return false;
    const result = await settlePromise(() =>
      api.dialogs.confirm(message, {
        ...(options?.destructive === true ? { variant: "destructive" as const } : {}),
        ...(options?.confirmLabel === undefined ? {} : { confirmLabel: options.confirmLabel }),
      }),
    );
    return result._tag === "Success" && result.value;
  };

  // A fresh checker per action, so a lookup never outlives the threads and projects it read.
  const projectInRepo = (repoRoot: string, worktreePaths?: ReadonlyArray<string>) =>
    projectInRepoChecker({
      projectRootOf: (projectId: ProjectId) =>
        readProject(scopeProjectRef(environmentId, projectId))?.workspaceRoot ?? null,
      repoRoot,
      showToplevel: async (cwd) => {
        const result = await historyRefsCommand({ environmentId, input: { cwd } });
        return result._tag === "Success" ? result.value.repoRoot : null;
      },
      ...(worktreePaths === undefined ? {} : { worktreePaths }),
    });

  /** The work changes the files under local-mode threads, so running ones are named first. */
  const confirmAgentWork = async (repoRoot: string, work: GitAgentWork) => {
    const active = await activeRootThreads({
      threads,
      projectInRepo: projectInRepo(repoRoot),
      environmentId,
      repoRoot,
    });
    if (active.length === 0) return true;
    const titles = active
      .map((thread) => t("git.confirm.threadTitle", { title: thread.title }))
      .join(t("git.confirm.threadTitleSeparator"));
    if (work === "checkout") return confirm(t("git.confirm.checkoutActive", { titles }));
    const action =
      work === "discard"
        ? t("git.confirm.agentAction.discard")
        : work === "stash"
          ? t("git.confirm.agentAction.stash")
          : t("git.confirm.agentAction.applyStash");
    return confirm(t("git.confirm.agentActive", { titles, action }));
  };

  return { confirm, confirmAgentWork, projectInRepo, threads };
}
