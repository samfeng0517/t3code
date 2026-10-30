import { RegistryContext } from "@effect/atom-react";
import { useT } from "~/i18n";
import { useAtomCommand } from "~/state/use-atom-command";
import type {
  EnvironmentId,
  PullRequestLabel,
  PullRequestLabelCandidate,
  PullRequestRef,
} from "@t3tools/contracts";
import { CheckIcon, TagIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { pullRequestLabelDraftChanges, readableFailure } from "./pullRequestDetail.logic";
import { PullRequestLabelChip } from "./pullRequestPresentation";
import { pullRequestLabelColor } from "./pullRequestList.logic";

function matches(candidate: PullRequestLabelCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.name.toLowerCase().includes(needle) ||
    (candidate.description ?? "").toLowerCase().includes(needle)
  );
}

interface LabelDraft {
  readonly key: string;
  readonly target: { readonly environmentId: EnvironmentId; readonly reference: PullRequestRef };
  readonly applied: ReadonlyArray<PullRequestLabel>;
  readonly names: ReadonlySet<string>;
}

export function PullRequestLabelPicker({
  environmentId,
  reference,
  labels,
  canEdit,
  allowed,
  onRefresh,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  labels: ReadonlyArray<PullRequestLabel>;
  canEdit: boolean;
  allowed: boolean;
  onRefresh: () => void;
}) {
  const t = useT();
  const registry = useContext(RegistryContext);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<LabelDraft | null>(null);
  const [submitting, setSubmitting] = useState<{
    readonly key: string;
    readonly labels: ReadonlyArray<PullRequestLabel>;
  } | null>(null);

  const key = JSON.stringify([
    environmentId,
    reference.projectId,
    reference.host ?? null,
    reference.repository,
    reference.number,
  ]);
  const currentKeyRef = useRef(key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a submit that settles after a PR switch must not refresh the new PR
  useEffect(() => {
    currentKeyRef.current = key;
  }, [key]);
  // Switching pull requests while the menu is open drops the draft unsent.
  if (draft !== null && draft.key !== key) {
    setDraft(null);
    setOpen(false);
  }
  const shown = submitting?.key === key ? submitting.labels : labels;
  const isSubmitting = submitting?.key === key;

  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.labelCandidates({ environmentId, input: reference }) : null,
  );
  const setLabels = useAtomCommand(pullRequestEnvironment.setLabels, {
    reportFailure: false,
  });

  const allCandidates = candidatesQuery.data?.candidates ?? [];
  const candidates = allCandidates.filter((entry) => matches(entry, query));
  const checkedNames = draft?.names ?? new Set(shown.map((label) => label.name));

  const submit = async (closed: LabelDraft) => {
    const changes = pullRequestLabelDraftChanges(closed.applied, closed.names, allCandidates);
    if (changes.toAdd.length === 0 && changes.toRemove.length === 0) return;
    setSubmitting({ key: closed.key, labels: changes.labels });
    const { environmentId: targetEnvironmentId, reference: targetReference } = closed.target;
    let failed = false;
    const send = async (names: ReadonlyArray<string>, applied: boolean) => {
      if (names.length === 0) return;
      const result = await setLabels({
        environmentId: targetEnvironmentId,
        input: { ...targetReference, labels: [...names], applied },
      });
      if (result._tag !== "Failure") return;
      failed = true;
      const name = names.join(t("pullRequestDetail.labels.listSeparator"));
      toastManager.add({
        type: "error",
        title: applied
          ? t("pullRequestDetail.labels.applyFailed", { name })
          : t("pullRequestDetail.labels.removeFailed", { name }),
        description: readableFailure(
          squashAtomCommandFailure(result),
          t("pullRequestDetail.labels.refusedHint"),
        ),
      });
    };
    await send(changes.toAdd, true);
    await send(changes.toRemove, false);
    setSubmitting((current) => (current?.key === closed.key ? null : current));
    if (!failed) return;
    if (currentKeyRef.current === closed.key) onRefresh();
    registry.refresh(
      pullRequestEnvironment.labelCandidates({
        environmentId: targetEnvironmentId,
        input: targetReference,
      }),
    );
  };

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (isSubmitting) return;
      setDraft({
        key,
        target: { environmentId, reference },
        applied: labels,
        names: new Set(labels.map((label) => label.name)),
      });
      setOpen(true);
      return;
    }
    setOpen(false);
    setDraft(null);
    if (draft !== null && draft.key === key) void submit(draft);
  };

  const toggle = (candidate: PullRequestLabelCandidate) => {
    setDraft((current) => {
      if (current === null) return current;
      const names = new Set(current.names);
      if (!names.delete(candidate.name)) names.add(candidate.name);
      return { ...current, names };
    });
  };

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {/* Zero-width anchor keeps the popup at the row's left edge without inheriting its width. */}
      <span ref={anchorRef} aria-hidden className="-mr-1" />
      {shown.length === 0 ? (
        <span className="text-muted-foreground">{t("pullRequests.ghost.none")}</span>
      ) : (
        shown.map((label) => (
          <PullRequestLabelChip
            key={label.name}
            label={label}
            size="default"
            className="max-w-48"
          />
        ))
      )}
      {canEdit ? (
        <PullRequestCandidatePicker
          icon={<TagIcon className="size-3.5" />}
          label={t("pullRequestDetail.labels.label")}
          allowed={allowed}
          disabledReason={t("pullRequestDetail.labels.disabledReason")}
          open={open}
          onOpenChange={onOpenChange}
          query={query}
          onQueryChange={setQuery}
          searchLabel={t("pullRequestDetail.labels.search")}
          isPending={candidatesQuery.isPending && candidatesQuery.data === null}
          error={candidatesQuery.data === null ? candidatesQuery.error : null}
          candidates={candidates}
          emptyLabel={t("pullRequestDetail.labels.empty")}
          noMatchLabel={t("pullRequestDetail.labels.noMatch")}
          errorLabel={t("pullRequestDetail.labels.error")}
          truncated={candidatesQuery.data?.truncated === true}
          truncatedLabel={t("pullRequestDetail.labels.truncated")}
          candidateKey={(candidate) => candidate.name}
          disabled={false}
          onSelect={toggle}
          anchor={anchorRef}
          triggerDisabled={isSubmitting}
        >
          {(candidate) => {
            const dot = pullRequestLabelColor(candidate.color);
            return (
              <>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-muted-foreground"
                  {...(dot ? { style: { backgroundColor: dot } } : {})}
                />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name}
                  {candidate.description ? (
                    <span className="text-muted-foreground"> · {candidate.description}</span>
                  ) : null}
                </span>
                {checkedNames.has(candidate.name) ? (
                  <CheckIcon
                    aria-label={t("pullRequestDetail.labels.applied")}
                    className="size-3.5 shrink-0"
                  />
                ) : null}
              </>
            );
          }}
        </PullRequestCandidatePicker>
      ) : null}
    </span>
  );
}
