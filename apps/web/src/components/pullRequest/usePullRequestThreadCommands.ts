import type { EnvironmentId, PullRequestRef, PullRequestReviewThread } from "@t3tools/contracts";
import { useState } from "react";

import { useT } from "~/i18n";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";

export function usePullRequestThreadCommands(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  onRefresh: () => void,
) {
  const t = useT();
  const replyToThread = useAtomCommand(pullRequestEnvironment.replyToThread, {
    reportFailure: false,
  });
  const setThreadResolution = useAtomCommand(pullRequestEnvironment.setThreadResolution, {
    reportFailure: false,
  });
  const [resolving, setResolving] = useState(false);

  const replyTo = (threadId: string) => async (body: string) => {
    const result = await replyToThread({ environmentId, input: { ...reference, threadId, body } });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: t("pullRequestDetail.timeline.replyFailed") });
      return false;
    }
    onRefresh();
    return true;
  };

  // Success relies on the command patching the cached activity, so no refresh follows.
  const toggleResolved = async (thread: Pick<PullRequestReviewThread, "id" | "isResolved">) => {
    if (resolving) return false;
    setResolving(true);
    const result = await setThreadResolution({
      environmentId,
      input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
    });
    setResolving(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: t("pullRequestDetail.code.conversationUpdateFailed"),
      });
      return false;
    }
    return true;
  };

  return { replyTo, toggleResolved, resolving };
}
