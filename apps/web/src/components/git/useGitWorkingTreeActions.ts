import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import { buildWorkingTreeMenu } from "./gitContextMenus";
import type { WorkingTreeRow } from "./gitWorkingTreeState";
import type { useGitConfirm } from "./useGitConfirm";
import type { GitWriteActions } from "./useGitWriteActions";

interface GitStashPrompt {
  /** `null` cancels; an empty message lets git write its default one. */
  readonly finish: (message: string | null) => void;
}

/** Stage, unstage, discard and stash for the uncommitted changes panel, on the page's write lock. */
export function useGitWorkingTreeActions(input: {
  readonly environmentId: EnvironmentId;
  readonly repoRoot: string | null;
  readonly writes: GitWriteActions;
  readonly confirm: ReturnType<typeof useGitConfirm>;
  /** HEAD's working tree changed shape (discarded or stashed), so the graph selection resets. */
  readonly onHeadChanged: () => void;
}) {
  const t = useT();
  const { environmentId, repoRoot, writes, onHeadChanged } = input;
  const { confirm, confirmAgentWork } = input.confirm;
  const commandOptions = { reportFailure: false };
  const stageCommand = useAtomCommand(gitEnvironment.stage, commandOptions);
  const unstageCommand = useAtomCommand(gitEnvironment.unstage, commandOptions);
  const discardCommand = useAtomCommand(gitEnvironment.discard, commandOptions);
  const discardAllCommand = useAtomCommand(gitEnvironment.discardAll, commandOptions);
  const stashPushCommand = useAtomCommand(gitEnvironment.stashPush, commandOptions);
  const [stashPrompt, setStashPrompt] = useState<GitStashPrompt | null>(null);

  const askStashMessage = () =>
    new Promise<string | null>((resolve) => {
      setStashPrompt({
        finish: (message) => {
          setStashPrompt(null);
          resolve(message);
        },
      });
    });

  const stage = async (paths: ReadonlyArray<string>) => {
    const [first, ...rest] = paths;
    if (repoRoot === null || first === undefined) return;
    const cwd = repoRoot;
    await writes.run(
      "stage",
      () => stageCommand({ environmentId, input: { cwd, paths: [first, ...rest] } }),
      () => null,
    );
  };

  const unstage = async (paths: ReadonlyArray<string>) => {
    const [first, ...rest] = paths;
    if (repoRoot === null || first === undefined) return;
    const cwd = repoRoot;
    await writes.run(
      "unstage",
      () => unstageCommand({ environmentId, input: { cwd, paths: [first, ...rest] } }),
      () => null,
    );
  };

  const discard = async (row: WorkingTreeRow) => {
    if (repoRoot === null) return;
    const cwd = repoRoot;
    if (!(await confirmAgentWork(cwd, "discard"))) return;
    const name = row.path.slice(row.path.lastIndexOf("/") + 1);
    const untracked = row.diffArea === "untracked";
    const confirmed = await confirm(
      untracked
        ? t("git.confirm.deleteUntracked", { name })
        : t("git.confirm.discardFile", { name }),
      {
        destructive: true,
        confirmLabel: untracked ? t("git.menu.delete") : t("git.confirm.discardAction"),
      },
    );
    if (!confirmed) return;
    await writes.run(
      "discard",
      () => discardCommand({ environmentId, input: { cwd, paths: [row.path] } }),
      () => t("git.toast.discarded"),
    );
  };

  const discardAll = async () => {
    if (repoRoot === null) return;
    const cwd = repoRoot;
    if (!(await confirmAgentWork(cwd, "discard"))) return;
    const confirmed = await confirm(t("git.confirm.discardAll"), {
      destructive: true,
      confirmLabel: t("git.workingTree.discardAll"),
    });
    if (!confirmed) return;
    const outcome = await writes.run(
      "discard-all",
      () => discardAllCommand({ environmentId, input: { cwd } }),
      () => t("git.toast.discarded"),
      { awaitRefresh: true },
    );
    if (outcome !== null) onHeadChanged();
  };

  const stash = async (message: string | null) => {
    if (repoRoot === null) return;
    const cwd = repoRoot;
    const trimmed = message?.trim() ?? "";
    const outcome = await writes.run(
      "stash",
      () =>
        stashPushCommand({
          environmentId,
          input: trimmed.length === 0 ? { cwd } : { cwd, message: trimmed },
        }),
      () => t("git.toast.stashed"),
      { awaitRefresh: true },
    );
    if (outcome !== null) onHeadChanged();
  };

  const stashWithPrompt = async () => {
    if (repoRoot === null || !(await confirmAgentWork(repoRoot, "stash"))) return;
    const message = await askStashMessage();
    if (message === null) return;
    await stash(message);
  };

  const openPanelMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const items = buildWorkingTreeMenu({
      canWrite: writes.canWrite,
      isOnline: writes.isOnline,
      pending: writes.pending !== null,
    });
    if (items.length === 0) return;
    const clicked = await settlePromise(() => api.contextMenu.show(items, position));
    if (clicked._tag === "Failure" || clicked.value === null) return;
    if (clicked.value === "stash-changes") return stashWithPrompt();
    return discardAll();
  };

  return { stage, unstage, discard, discardAll, stash, stashPrompt, openPanelMenu };
}
