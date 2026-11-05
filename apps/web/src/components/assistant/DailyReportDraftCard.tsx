import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AssistantDraftStatusValue,
  AssistantError,
  type AssistantDailyReportStatus,
  type AssistantDraft,
  type AssistantDraftItem,
  type AssistantDraftSection,
  type AssistantProject,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { useT } from "~/i18n";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "../../localApi";
import { assistantEnvironment } from "../../state/assistant";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { toastCommandFailure } from "./AssistantClockBar";
import {
  cardMode,
  DRAFT_SECTIONS,
  formatReportDate,
  orderedSources,
  withSectionOrder,
  type DraftCardMode,
} from "./dailyReportDraftCard.logic";

const isAssistantError = Schema.is(AssistantError);
const isDraftStatus = Schema.is(AssistantDraftStatusValue);

const STATUS_VARIANT = {
  new: "secondary",
  processing: "info",
  finished: "success",
  blocking: "error",
} as const satisfies Record<AssistantDraftStatusValue, string>;

const NO_PROJECT = "none";
const OTHER_PROJECT = "other";

interface DraftForm {
  readonly items: ReadonlyArray<AssistantDraftItem>;
  readonly problemText: string;
}

type DraftAction = "save" | "submit" | "regenerate";

function formOf(draft: AssistantDraft): DraftForm {
  return { items: draft.items, problemText: draft.problemText };
}

function CardShell(props: { readonly dimmed?: boolean; readonly children: ReactNode }) {
  return (
    <div
      className={cn(
        "w-full max-w-xl rounded-lg border border-border bg-card px-3.5 py-3",
        props.dimmed && "opacity-60",
      )}
    >
      {props.children}
    </div>
  );
}

function CardHeader(props: { readonly reportDate: string; readonly label?: string }) {
  const t = useT();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold">
        {t("assistantPage.draftCard.title", { date: formatReportDate(props.reportDate) })}
      </span>
      {props.label === undefined ? null : (
        <span className="text-xs text-muted-foreground">{props.label}</span>
      )}
    </div>
  );
}

function SectionLabel(props: { readonly children: ReactNode }) {
  return <div className="mt-2 mb-1 text-xs text-muted-foreground">{props.children}</div>;
}

function ReadonlyItemRow(props: { readonly item: AssistantDraftItem }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-sm">{props.item.content}</span>
      <Badge size="sm" variant={STATUS_VARIANT[props.item.status]}>
        {t(`assistantPage.draftCard.status.${props.item.status}`)}
      </Badge>
    </div>
  );
}

function SourceLine(props: { readonly draft: AssistantDraft }) {
  const t = useT();
  const sources = orderedSources(props.draft.sources);
  if (sources.length === 0) return null;
  const line = sources
    .map((source) => {
      const mark = t(
        source.status === "failed"
          ? "assistantPage.draftCard.source.failed"
          : "assistantPage.draftCard.source.ok",
        { source: t(`assistantPage.draftCard.source.${source.key}`) },
      );
      return source.note ? `${mark} ${source.note}` : mark;
    })
    .join(t("assistantPage.draftCard.sourceSeparator"));
  return <p className="mt-0.5 text-xs text-muted-foreground">{line}</p>;
}

/** An older proposal: the first item and a count, nothing to operate. */
function SupersededCard(props: {
  readonly reportDate: string;
  readonly input: { readonly items: ReadonlyArray<AssistantDraftItem> } | null;
}) {
  const t = useT();
  const first = props.input?.items[0];
  return (
    <CardShell dimmed>
      <CardHeader reportDate={props.reportDate} label={t("assistantPage.draftCard.superseded")} />
      {props.input === null || first === undefined ? null : (
        <>
          <div className="mt-2">
            <ReadonlyItemRow item={first} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("assistantPage.draftCard.itemCount", { n: props.input.items.length })}
          </p>
        </>
      )}
    </CardShell>
  );
}

function ReadonlySections(props: { readonly draft: AssistantDraft }) {
  const t = useT();
  return (
    <>
      {DRAFT_SECTIONS.map((section) => (
        <div key={section}>
          <SectionLabel>{t(`assistantPage.draftCard.section.${section}`)}</SectionLabel>
          <div className="flex flex-col gap-1">
            {props.draft.items
              .filter((item) => item.section === section)
              .map((item, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- draft items carry no id and these rows keep no state
                <ReadonlyItemRow key={index} item={item} />
              ))}
          </div>
        </div>
      ))}
      {props.draft.problemText === "" ? null : (
        <>
          <SectionLabel>{t("assistantPage.draftCard.section.problem")}</SectionLabel>
          <p className="text-sm whitespace-pre-wrap">{props.draft.problemText}</p>
        </>
      )}
    </>
  );
}

function projectKey(item: AssistantDraftItem): string {
  if (item.projectOther !== null) return OTHER_PROJECT;
  return item.projectId === null ? NO_PROJECT : String(item.projectId);
}

function preventEnter(event: KeyboardEvent<HTMLInputElement>) {
  // IME composition uses Enter to commit text; only a bare Enter is swallowed.
  if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
}

function EditableItemRow(props: {
  readonly item: AssistantDraftItem;
  readonly projects: ReadonlyArray<AssistantProject>;
  readonly onEdit: (patch: Partial<AssistantDraftItem>) => void;
  readonly onCommit: (patch?: Partial<AssistantDraftItem>) => void;
  readonly onDelete: () => void;
}) {
  const t = useT();
  const { item, projects } = props;
  const key = projectKey(item);
  const projectLabel =
    key === OTHER_PROJECT
      ? t("assistantPage.draftCard.otherProject")
      : key === NO_PROJECT
        ? t("assistantPage.draftCard.noProject")
        : (projects.find((project) => project.id === item.projectId)?.name ?? key);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
      <div className="min-w-40 flex-1">
        <Input
          unstyled
          size="compact"
          aria-label={t("assistantPage.draftCard.content")}
          value={item.content}
          onKeyDown={preventEnter}
          onChange={(event) => props.onEdit({ content: event.currentTarget.value })}
          onBlur={() => props.onCommit()}
        />
      </div>
      <Select
        value={item.status}
        onValueChange={(value) => {
          if (isDraftStatus(value)) props.onCommit({ status: value });
        }}
      >
        <SelectTrigger
          variant="ghost"
          size="compact"
          aria-label={t("assistantPage.draftCard.status")}
        >
          <SelectValue>{t(`assistantPage.draftCard.status.${item.status}`)}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {AssistantDraftStatusValue.literals.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`assistantPage.draftCard.status.${status}`)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={key}
        onValueChange={(value) => {
          if (value === null || value === key) return;
          props.onCommit(
            value === NO_PROJECT
              ? { projectId: null, projectOther: null }
              : value === OTHER_PROJECT
                ? { projectId: null, projectOther: "" }
                : { projectId: Number(value), projectOther: null },
          );
        }}
      >
        <SelectTrigger
          variant="ghost"
          size="compact"
          aria-label={t("assistantPage.draftCard.project")}
        >
          <SelectValue>{projectLabel}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={NO_PROJECT}>{t("assistantPage.draftCard.noProject")}</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={String(project.id)}>
              {project.name}
            </SelectItem>
          ))}
          <SelectItem value={OTHER_PROJECT}>{t("assistantPage.draftCard.otherProject")}</SelectItem>
        </SelectPopup>
      </Select>
      {item.projectOther === null ? null : (
        <div className="w-32">
          <Input
            size="compact"
            aria-label={t("assistantPage.draftCard.otherProject")}
            value={item.projectOther}
            onKeyDown={preventEnter}
            onChange={(event) => props.onEdit({ projectOther: event.currentTarget.value })}
            onBlur={() => props.onCommit()}
          />
        </div>
      )}
      <Button size="xs" variant="ghost-muted" onClick={props.onDelete}>
        {t("assistantPage.draftCard.deleteItem")}
      </Button>
    </div>
  );
}

function EditableSections(props: {
  readonly environmentId: EnvironmentId;
  readonly form: DraftForm;
  readonly onEdit: (form: DraftForm) => void;
  readonly onCommit: (form: DraftForm) => void;
}) {
  const t = useT();
  const projects =
    useEnvironmentQuery(
      assistantEnvironment.projects({ environmentId: props.environmentId, input: {} }),
    ).data ?? [];
  const { form } = props;
  const patched = (index: number, patch: Partial<AssistantDraftItem>): DraftForm => ({
    ...form,
    items: form.items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
  });
  const append = (section: AssistantDraftSection) =>
    props.onCommit({
      ...form,
      items: [
        ...form.items,
        { section, content: "", status: "new", projectId: null, projectOther: null, sortOrder: 0 },
      ],
    });
  return (
    <>
      {DRAFT_SECTIONS.map((section) => (
        <div key={section}>
          <SectionLabel>{t(`assistantPage.draftCard.section.${section}`)}</SectionLabel>
          <div className="flex flex-col gap-1">
            {form.items.map((item, index) =>
              item.section !== section ? null : (
                <EditableItemRow
                  // oxlint-disable-next-line react/no-array-index-key -- draft items carry no id; the rows are fully controlled
                  key={index}
                  item={item}
                  projects={projects}
                  onEdit={(patch) => props.onEdit(patched(index, patch))}
                  onCommit={(patch) => props.onCommit(patch ? patched(index, patch) : form)}
                  onDelete={() =>
                    props.onCommit({ ...form, items: form.items.filter((_, at) => at !== index) })
                  }
                />
              ),
            )}
            <div>
              <Button size="xs" variant="ghost-muted" onClick={() => append(section)}>
                {t("assistantPage.draftCard.addItem")}
              </Button>
            </div>
          </div>
        </div>
      ))}
      <SectionLabel>{t("assistantPage.draftCard.section.problem")}</SectionLabel>
      <Textarea
        size="sm"
        aria-label={t("assistantPage.draftCard.section.problem")}
        value={form.problemText}
        onChange={(event) => props.onEdit({ ...form, problemText: event.currentTarget.value })}
        onBlur={() => props.onCommit(form)}
      />
    </>
  );
}

function LiveCard(props: {
  readonly environmentId: EnvironmentId;
  readonly reportDate: string;
  readonly mode: Exclude<DraftCardMode, "superseded">;
  readonly draft: AssistantDraft;
  readonly report: AssistantDailyReportStatus | null;
  readonly runActive: boolean;
}) {
  const t = useT();
  const { environmentId, reportDate, draft, mode } = props;
  const saveDraft = useAtomCommand(assistantEnvironment.saveDraft, { reportFailure: false });
  const submitDailyReport = useAtomCommand(assistantEnvironment.submitDailyReport, {
    reportFailure: false,
  });
  const regenerateDraft = useAtomCommand(assistantEnvironment.regenerateDraft, {
    reportFailure: false,
  });
  const reloadState = useAtomRefresh(assistantEnvironment.state({ environmentId, input: {} }));

  const [local, setLocal] = useState(() => ({ revision: draft.revision, form: formOf(draft) }));
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reseedRequested, setReseedRequested] = useState(false);
  const [pending, setPending] = useState<Exclude<DraftAction, "save"> | null>(null);
  // Handlers outrun renders: these keep saves serialized and a click burst to one request.
  const saveInFlight = useRef<Promise<number | null> | null>(null);
  const queuedSave = useRef<DraftForm | null>(null);
  const dirty = useRef(false);
  const actionInFlight = useRef(false);

  // Another writer moved the draft on: take its version unless the user is mid-edit here.
  if (draft.revision !== local.revision && (reseedRequested || (!focused && !saving))) {
    setLocal({ revision: draft.revision, form: formOf(draft) });
    setReseedRequested(false);
  }

  const reportFailure = (result: AtomCommandResult<unknown, unknown>, action: DraftAction) => {
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    if (isAssistantError(error) && error.reason === "stale-revision") {
      reloadState();
      setReseedRequested(true);
      if (action !== "regenerate") {
        toastManager.add({ type: "error", title: t("assistantPage.draftCard.staleRevision") });
        return;
      }
    }
    toastCommandFailure(result, t);
  };

  const persist = (form: DraftForm): Promise<number | null> => {
    if (saveInFlight.current !== null) {
      queuedSave.current = form;
      return saveInFlight.current;
    }
    setSaving(true);
    const run = async (revision: number, next: DraftForm): Promise<number | null> => {
      const result = await saveDraft({
        environmentId,
        input: {
          reportDate,
          revision,
          items: withSectionOrder(next.items),
          problemText: next.problemText,
        },
      });
      if (result._tag !== "Success") {
        queuedSave.current = null;
        reportFailure(result, "save");
        return null;
      }
      const queued = queuedSave.current;
      queuedSave.current = null;
      return queued === null ? result.value.revision : run(result.value.revision, queued);
    };
    const chain = run(local.revision, form).then((revision) => {
      saveInFlight.current = null;
      setSaving(false);
      if (revision !== null) setLocal((current) => ({ ...current, revision }));
      return revision;
    });
    saveInFlight.current = chain;
    return chain;
  };

  const edit = (form: DraftForm) => {
    dirty.current = true;
    setLocal((current) => ({ ...current, form }));
  };
  const commit = (form: DraftForm) => {
    if (form === local.form && !dirty.current) return;
    dirty.current = false;
    setLocal((current) => ({ ...current, form }));
    void persist(form);
  };
  const latestRevision = () => saveInFlight.current ?? Promise.resolve(local.revision);

  const submit = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending("submit");
    const revision = await latestRevision();
    if (revision !== null) {
      const result = await submitDailyReport({ environmentId, input: { reportDate, revision } });
      if (result._tag !== "Success") reportFailure(result, "submit");
    }
    actionInFlight.current = false;
    setPending(null);
  };

  const regenerate = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const edited = draft.editedByUser || saveInFlight.current !== null;
    if (
      edited &&
      !(await ensureLocalApi().dialogs.confirm(t("assistantPage.draftCard.regenerateConfirm")))
    ) {
      actionInFlight.current = false;
      return;
    }
    setPending("regenerate");
    const revision = await latestRevision();
    if (revision !== null) {
      const result = await regenerateDraft({ environmentId, input: { reportDate, revision } });
      if (result._tag !== "Success") reportFailure(result, "regenerate");
    }
    actionInFlight.current = false;
    setPending(null);
  };

  return (
    <CardShell>
      <div
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <CardHeader
          reportDate={reportDate}
          {...(mode === "editable" ? { label: t("assistantPage.draftCard.editable") } : {})}
        />
        <SourceLine draft={draft} />
        {mode === "editable" ? (
          <EditableSections
            environmentId={environmentId}
            form={local.form}
            onEdit={edit}
            onCommit={commit}
          />
        ) : (
          <ReadonlySections draft={draft} />
        )}
        {mode === "editable" ? (
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {t("assistantPage.draftCard.slackNote")}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => void regenerate()}
            >
              {pending === "regenerate" ? <Spinner /> : null}
              {t("assistantPage.draftCard.regenerate")}
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={props.runActive || pending !== null}
              onClick={() => void submit()}
            >
              {pending === "submit" ? <Spinner /> : null}
              {t("assistantPage.draftCard.submit")}
            </Button>
          </div>
        ) : mode === "submitted" && props.report !== null ? (
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="link"
              render={<a href={props.report.erpDailyReportUrl} target="_blank" rel="noreferrer" />}
            >
              {t("assistantPage.draftCard.editInErp")}
            </Button>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

/** The assistant's daily report proposal, inline in the assistant thread's timeline. */
export function DailyReportDraftCard(props: {
  readonly environmentId: EnvironmentId;
  readonly reportDate: string;
  readonly version: number;
  readonly input: {
    readonly items: ReadonlyArray<AssistantDraftItem>;
    readonly problemText: string;
  } | null;
  /** The assistant thread's latest run has not finished; 送出 waits for it. */
  readonly runActive: boolean;
}) {
  const { environmentId, reportDate } = props;
  const state = AsyncResult.getOrElse(
    useAtomValue(assistantEnvironment.state({ environmentId, input: {} })),
    () => null,
  );
  const report = useEnvironmentQuery(
    assistantEnvironment.dailyReport({ environmentId, input: {} }),
  ).data;
  const canOperate = useAtomValue(assistantEnvironment.saveDraft.permissionAtom(environmentId));
  // Until the state stream answers there is nothing to compare versions against.
  if (state === null) {
    return (
      <CardShell>
        <CardHeader reportDate={reportDate} />
      </CardShell>
    );
  }
  const draft = state.drafts.find((entry) => entry.reportDate === reportDate) ?? null;
  const mode = cardMode({ version: props.version, reportDate, draft, report, canOperate });
  if (mode === "superseded" || draft === null) {
    return <SupersededCard reportDate={reportDate} input={props.input} />;
  }
  return (
    <LiveCard
      environmentId={environmentId}
      reportDate={reportDate}
      mode={mode}
      draft={draft}
      report={report}
      runActive={props.runActive}
    />
  );
}
