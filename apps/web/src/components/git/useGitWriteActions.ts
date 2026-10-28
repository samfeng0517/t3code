import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, GitCommandError, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";

import { useT } from "~/i18n";
import { randomUUID } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";
import { useGitStackedAction, useVcsPullAction } from "~/state/sourceControlActions";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { toastManager } from "../ui/toast";
import { settleGitWriteAndRefresh } from "./gitWriteSettle";

export interface GitWriteActions {
  /** The connection holds `source-control:write`; without it no write control renders. */
  readonly canWrite: boolean;
  readonly isOnline: boolean;
  /** The running write's kind; every write on the page waits while this is set. */
  readonly pending: string | null;
  readonly run: <T>(
    kind: string,
    action: () => Promise<AtomCommandResult<T, unknown>>,
    successToast: (value: T) => string | null,
  ) => Promise<T | null>;
  readonly fetch: () => Promise<unknown>;
  readonly pull: () => Promise<unknown>;
  readonly push: () => Promise<unknown>;
}

const isGitCommandError = Schema.is(GitCommandError);

function failureDescription(error: unknown): string | undefined {
  if (isGitCommandError(error)) return error.detail;
  return error instanceof Error ? error.message : undefined;
}

/** Fetch, pull and push for one Git tab, with the single write lock its context menus share. */
export function useGitWriteActions(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly repoRoot: string | null;
  readonly refresh: () => Promise<void>;
}): GitWriteActions {
  const t = useT();
  const { environmentId, projectId, repoRoot, refresh } = input;
  const scope = { environmentId, cwd: repoRoot };
  const fetchCommand = useAtomCommand(vcsEnvironment.fetch, { reportFailure: false });
  // Local-only status, like the toolbar's: the Git page never polls the remote.
  const pullAction = useVcsPullAction(scope, { includeRemote: false });
  const stackedAction = useGitStackedAction(scope, { includeRemote: false });
  const canWrite = useAtomValue(vcsEnvironment.fetch.permissionAtom(environmentId));
  const isOnline = useEnvironment(environmentId)?.connection.phase === "connected";
  const [pending, setPending] = useState<string | null>(null);
  // State lags a double click by a render; the ref closes the lock synchronously.
  const lock = useRef(false);

  const run = async <T>(
    kind: string,
    action: () => Promise<AtomCommandResult<T, unknown>>,
    successToast: (value: T) => string | null,
  ): Promise<T | null> => {
    if (lock.current) return null;
    lock.current = true;
    setPending(kind);
    const result = await settleGitWriteAndRefresh(action, refresh);
    lock.current = false;
    setPending(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return null;
      const description = failureDescription(squashAtomCommandFailure(result));
      toastManager.add({
        type: "error",
        title: t("git.toast.failed"),
        ...(description === undefined ? {} : { description }),
      });
      return null;
    }
    const title = successToast(result.value);
    if (title !== null) toastManager.add({ type: "success", title });
    return result.value;
  };

  const fetchRemote = () => {
    const cwd = repoRoot;
    if (cwd === null) return Promise.resolve(null);
    return run(
      "fetch",
      () => fetchCommand({ environmentId, input: { cwd } }),
      (value) => t("git.toast.fetched", { remote: value.remoteName }),
    );
  };

  const pull = () =>
    run("pull", pullAction.run, (value) => {
      if (value.status === "skipped_up_to_date") return t("git.toast.upToDate");
      return value.pulledCommitCount === undefined
        ? t("git.toast.pulledLatest")
        : t("git.toast.pulled", { count: value.pulledCommitCount });
    });

  const push = () =>
    run(
      "push",
      () => stackedAction.run({ actionId: randomUUID(), action: "push", projectId }),
      (value) => {
        if (value.push.status === "skipped_up_to_date") return t("git.toast.upToDate");
        const branch = value.push.branch ?? value.branch.name;
        if (value.push.status !== "pushed" || branch === undefined) return value.toast.title;
        return t("git.toast.pushed", { branch });
      },
    );

  return { canWrite, isOnline, pending, run, fetch: fetchRemote, pull, push };
}
