import { useAtomValue } from "@effect/atom-react";
import { useT } from "~/i18n";
import { useAtomCommand } from "~/state/use-atom-command";
import type {
  EnvironmentId,
  PullRequestActor,
  PullRequestAssigneeCandidate,
  PullRequestRef,
} from "@t3tools/contracts";
import { CheckIcon, UserCheckIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { pullRequestAssigneeToast, readableFailure } from "./pullRequestDetail.logic";

function matches(candidate: PullRequestAssigneeCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestAssigneePicker({
  environmentId,
  reference,
  assignees,
  multiple,
  viewerAllowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  assignees: ReadonlyArray<PullRequestActor>;
  multiple: boolean;
  viewerAllowed: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const connectionAllowed = useAtomValue(
    pullRequestEnvironment.setAssignees.permissionAtom(environmentId),
  );
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.assigneeCandidates({ environmentId, input: reference }) : null,
  );
  const setAssignees = useAtomCommand(pullRequestEnvironment.setAssignees, {
    reportFailure: false,
  });

  const candidates = (candidatesQuery.data?.candidates ?? []).filter((entry) =>
    matches(entry, query),
  );
  const current = assignees[0];

  const toggle = async (candidate: PullRequestAssigneeCandidate) => {
    if (pending !== null) return;
    const login = candidate.login;
    const assigned = !candidate.isAssigned;
    setPending(login);
    const result = await setAssignees({
      environmentId,
      input: { ...reference, logins: [login], assigned },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: assigned
          ? t("pullRequestDetail.assignees.assignFailed", { login })
          : t("pullRequestDetail.assignees.unassignFailed", { login }),
        description: readableFailure(
          squashAtomCommandFailure(result),
          t("pullRequestDetail.assignees.refusedHint"),
        ),
      });
      return;
    }
    const outcome = pullRequestAssigneeToast({
      before: assignees,
      login,
      assigned,
      after: result.value.assignees,
      multiple,
    });
    if (outcome.type === "error") {
      toastManager.add({
        type: "error",
        title: t(`pullRequestDetail.assignees.${outcome.key}`, { login }),
        description: t("pullRequestDetail.assignees.refusedHint"),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title:
        outcome.key === "replaced"
          ? t("pullRequestDetail.assignees.replaced", { from: outcome.from, to: login })
          : t(`pullRequestDetail.assignees.${outcome.key}`, { login }),
    });
  };

  return (
    <PullRequestCandidatePicker
      icon={<UserCheckIcon className="size-3.5" />}
      label={t("pullRequestDetail.assignees.label")}
      allowed={connectionAllowed && viewerAllowed}
      disabledReason={
        connectionAllowed
          ? t("pullRequestDetail.assignees.disabledReason")
          : t("pullRequestDetail.assignees.connectionDisabledReason")
      }
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel={t("pullRequestDetail.assignees.search")}
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel={t("pullRequestDetail.assignees.empty")}
      noMatchLabel={t("pullRequestDetail.assignees.noMatch")}
      errorLabel={t("pullRequestDetail.assignees.error")}
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel={t("pullRequestDetail.assignees.truncated")}
      candidateKey={(candidate) => candidate.login}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
      closeOnSelect={!multiple}
      notice={
        multiple
          ? undefined
          : current
            ? t("pullRequestDetail.assignees.singleHint", { login: current.login })
            : t("pullRequestDetail.assignees.singleHintEmpty")
      }
    >
      {(candidate) => (
        <>
          <PullRequestActorLabel actor={candidate} className="flex-1" />
          {candidate.isAssigned ? (
            <CheckIcon
              aria-label={t("pullRequestDetail.assignees.alreadyAssigned")}
              className="size-3.5 shrink-0"
            />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
