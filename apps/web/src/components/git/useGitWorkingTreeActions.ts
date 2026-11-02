import {
  type AtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  GitCommitHookRejectedError,
  type GitCommitIndexMode,
  GitNothingStagedError,
  type ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useT } from "~/i18n";
import { readLocalApi } from "~/localApi";
import { gitEnvironment } from "~/state/git";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import { SHORT_HASH_LENGTH } from "./gitHistoryState";
import { buildWorkingTreeMenu } from "./gitContextMenus";
import type { WorkingTreeRow } from "./gitWorkingTreeState";
import type { useGitConfirm } from "./useGitConfirm";
import type { GitWriteActions } from "./useGitWriteActions";

const isCommitHookRejected = Schema.is(GitCommitHookRejectedError);
const isNothingStaged = Schema.is(GitNothingStagedError);

interface GitStashPrompt {
  /** `null` cancels; an empty message lets git write its default one. */
  readonly finish: (message: string | null) => void;
}

/** Stage, unstage, discard and stash for the uncommitted changes panel, on the page's write lock. */
export function useGitWorkingTreeActions(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly repoRoot: string | null;
  readonly writes: GitWriteActions;
  readonly confirm: ReturnType<typeof useGitConfirm>;
  /** HEAD's working tree changed shape (discarded or stashed), so the graph selection resets. */
  readonly onHeadChanged: () => void;
}) {
  const t = useT();
  const { environmentId, projectId, repoRoot, writes, onHeadChanged } = input;
  const { confirm, confirmAgentWork } = input.confirm;
  const commandOptions = { reportFailure: false };
  const stageCommand = useAtomCommand(gitEnvironment.stage, commandOptions);
  const unstageCommand = useAtomCommand(gitEnvironment.unstage, commandOptions);
  const discardCommand = useAtomCommand(gitEnvironment.discard, commandOptions);
  const discardAllCommand = useAtomCommand(gitEnvironment.discardAll, commandOptions);
  const stashPushCommand = useAtomCommand(gitEnvironment.stashPush, commandOptions);
  const commitCommand = useAtomCommand(gitEnvironment.commitIndex, commandOptions);
  const [stashPrompt, setStashPrompt] = useState<GitStashPrompt | null>(null);
  // Held here, not in the commit box, so the running label survives the box unmounting.
  const [commitGeneratesMessage, setCommitGeneratesMessage] = useState(false);

  /** Commits what is staged, or everything for `all`; an empty message is generated. Resolves true on success. */
  const commit = async (message: string, mode: GitCommitIndexMode): Promise<boolean> => {
    if (repoRoot === null) return false;
    const cwd = repoRoot;
    const trimmed = message.trim();
    setCommitGeneratesMessage(trimmed.length === 0);
    const outcome = await writes.run(
      "commit",
      async (): Promise<AtomCommandResult<{ commitSha: string } | null, unknown>> => {
        const result = await commitCommand({
          environmentId,
          input:
            trimmed.length === 0
              ? { cwd, projectId, mode }
              : { cwd, projectId, mode, message: trimmed },
        });
        if (result._tag === "Success") return AsyncResult.success(result.value);
        const error = squashAtomCommandFailure(result);
        const handled = isCommitHookRejected(error)
          ? t("git.toast.commitHookRejected")
          : isNothingStaged(error)
            ? t("git.toast.nothingStaged")
            : null;
        if (handled === null) return AsyncResult.failure(result.cause);
        toastManager.add({ type: "error", title: handled });
        return AsyncResult.success(null);
      },
      (value) =>
        value === null
          ? null
          : t("git.toast.committed", { hash: value.commitSha.slice(0, SHORT_HASH_LENGTH) }),
      { awaitRefresh: true },
    );
    if (outcome === null) return false;
    onHeadChanged();
    return true;
  };

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

  return {
    stage,
    unstage,
    discard,
    discardAll,
    stash,
    commit,
    commitGeneratesMessage,
    stashPrompt,
    openPanelMenu,
  };
}
