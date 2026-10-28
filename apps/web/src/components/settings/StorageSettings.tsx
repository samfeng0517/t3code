import type {
  StorageCleanupReport,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatBytes } from "../../lib/formatBytes";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { DatabaseStorageNotice } from "./DatabaseStorageNotice";
import { AdvancedSettings } from "./AdvancedSettings";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsGroup } from "./SettingsGroup";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { useT, type Translate } from "~/i18n";

export function WorktreesDirectoryRow() {
  const t = useT();
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      title={t("settingsPages.storage.location.title")}
      description={t("settingsPages.storage.location.description")}
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label={t("settingsPages.storage.location.resetLabel")}
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label={t("settingsPages.storage.location.title")}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={
            mixed ? t("settings.common.mixed") : t("settingsPages.storage.location.placeholder")
          }
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  minimum?: number;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={minimum}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(minimum, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement
              aria-label={t("settingsPages.storage.retention.decrease", { label })}
            />
            <NumberFieldInput
              aria-label={t("settingsPages.storage.retention.inDays", { label })}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              {t("settingsPages.storage.retention.days")}
            </span>
            <NumberFieldIncrement
              aria-label={t("settingsPages.storage.retention.increase", { label })}
            />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">{t("settingsPages.storage.off")}</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

function lastRunSummary(
  t: Translate,
  entries: readonly { readonly label: string; readonly counts: string }[],
  machineCount: number,
) {
  const first = entries[0];
  if (!first) return "";
  if (machineCount <= 1) return first.counts;
  if (entries.length === machineCount && entries.every((entry) => entry.counts === first.counts)) {
    return t("settingsPages.storage.lastRun.everyMachine", { counts: first.counts });
  }
  return entries.map((entry) => `${entry.label}: ${entry.counts}`).join(" · ");
}

function CleanupResults({
  report,
  environmentLabel,
}: {
  report: StorageCleanupReport;
  environmentLabel: string;
}) {
  const t = useT();
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? ((entry.threadId === null
                ? entry.path
                : entry.path?.split(/[\\/]/).findLast(Boolean)) ??
              t("settingsPages.storage.result.worktrees"))
            : entry.kind === "logs"
              ? t("settingsPages.storage.result.logs")
              : t("settingsPages.storage.result.browserArtifacts");
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={<span className="wrap-anywhere select-text">{name}</span>}
            description={
              <span className="block space-y-2 wrap-anywhere select-text">
                <span className={`block ${entry.outcome === "failed" ? "text-destructive" : ""}`}>
                  {entry.reason}
                </span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-border/60 pl-3">
                  <span>{t("settingsPages.storage.result.machine")}</span>
                  <span className="text-foreground/80">{environmentLabel}</span>
                  {entry.projectPath && (
                    <>
                      <span>{t("settingsPages.storage.result.project")}</span>
                      <code className="text-foreground/80">{entry.projectPath}</code>
                    </>
                  )}
                  {entry.path && (
                    <>
                      <span>{t("settingsPages.storage.result.folder")}</span>
                      <code className="text-foreground/80">{entry.path}</code>
                    </>
                  )}
                  {entry.threadTitle && (
                    <>
                      <span>{t("settingsPages.storage.result.thread")}</span>
                      <span>{entry.threadTitle}</span>
                    </>
                  )}
                </span>
              </span>
            }
            control={
              (entry.outcome === "removed" ||
                (entry.outcome === "kept" && entry.bytes !== null)) && (
                <span className="text-xs text-muted-foreground">
                  {[
                    entry.kind !== "worktree" && entry.files !== null
                      ? t(
                          entry.files === 1
                            ? "settingsPages.storage.result.files.one"
                            : "settingsPages.storage.result.files.other",
                          { count: entry.files.toLocaleString() },
                        )
                      : null,
                    entry.bytes !== null ? formatBytes(entry.bytes) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )
            }
          />
        );
      })}
      {report.omittedCount > 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {t("settingsPages.storage.result.moreResults", {
            label: environmentLabel,
            count: report.omittedCount.toLocaleString(),
          })}
        </p>
      )}
      {report.entries.length === 0 && report.omittedCount === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {t("settingsPages.storage.result.nothing", { label: environmentLabel })}
        </p>
      )}
    </>
  );
}

const storageCleanupReportsAtom = environmentAtomList(
  "web-storage-cleanup-reports",
  (environmentId) => serverEnvironment.storageCleanupReport({ environmentId, input: {} }),
);
const storageCleanupPermissionsAtom = environmentAtomList(
  "web-storage-cleanup-permissions",
  serverEnvironment.runStorageCleanup.permissionAtom,
);

function CleanupSection() {
  const t = useT();
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
  );
  const supportedIds = supported.map(({ environmentId }) => environmentId);
  const reports = useAtomValue(storageCleanupReportsAtom(environmentIdsKey(supportedIds)));
  const permissions = useAtomValue(storageCleanupPermissionsAtom(environmentIdsKey(supportedIds)));
  const state = supportedIds.map((environmentId, index) => {
    const query = reports[index]!;
    return {
      environmentId,
      allowed: permissions[index]!,
      report: query._tag === "Success" ? query.value : null,
      loading: query.waiting,
      failed: query._tag === "Failure",
    };
  });
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null ||
      rules.worktreeSettledAfterDays !== null ||
      rules.worktreeOnMerge ||
      rules.worktreeOnDelete ||
      rules.worktreeUnchanged;
    return (
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) =>
          override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
      counts: report
        ? report.counts.failed > 0
          ? t("settingsPages.storage.countsWithFailed", report.counts)
          : t("settingsPages.storage.counts", report.counts)
        : "",
      description: report
        ? report.counts.failed > 0
          ? t(
              report.counts.failed === 1
                ? "settingsPages.storage.lastRun.descriptionWithFailed.one"
                : "settingsPages.storage.lastRun.descriptionWithFailed.other",
              {
                time: formatRelativeTimeLabel(report.finishedAt, nowMs),
                bytes: formatBytes(report.bytesFreed),
                count: report.counts.failed,
              },
            )
          : t("settingsPages.storage.lastRun.description", {
              time: formatRelativeTimeLabel(report.finishedAt, nowMs),
              bytes: formatBytes(report.bytesFreed),
            })
        : query?.failed
          ? t("settingsPages.storage.lastRun.loadFailed")
          : query?.loading
            ? t("settingsPages.storage.lastRun.loading")
            : t("settingsPages.storage.lastRun.never"),
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    await Promise.all(
      supported
        .filter((environment) =>
          state.some((entry) => entry.environmentId === environment.environmentId && entry.allowed),
        )
        .map(async (environment) => {
          const result = await run({ environmentId: environment.environmentId, input: {} });
          if (result._tag === "Success") {
            const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
            if (failures.length > 0)
              toastManager.add({
                type: "error",
                title: t("settingsPages.storage.toast.cleanupFailed", { name: environment.label }),
                description: failures[0]!.reason,
              });
          } else if (!isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: t("settingsPages.storage.toast.runFailed", { name: environment.label }),
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
    ).finally(() => setPending(false));
  };
  return (
    <SettingsSection
      id="storage-cleanup"
      title={t("settingsPages.storage.cleanup.section")}
      variant="plain"
    >
      <SettingsGroup>
        <SettingsRow
          {...searchableSetting("storage-delete-now")}
          title={t("settingsPages.storage.deleteNow.title")}
          description={
            <span>
              {!hasRules
                ? t("settingsPages.storage.deleteNow.noRules")
                : summaries.map(({ environment, label, description }) => (
                    <span key={environment.environmentId} className="block">
                      {supported.length > 1 ? `${label}: ` : ""}
                      {description}
                    </span>
                  ))}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !hasRules || !state.some((entry) => entry.allowed)}
              onClick={() => void deleteNow()}
            >
              {pending
                ? t("settingsPages.storage.deleteNow.deleting")
                : t("settingsPages.storage.deleteNow.title")}
            </Button>
          }
        />
      </SettingsGroup>
      {summaries.some(({ report }) => report !== null) && (
        <FoldedSettingsSection
          id="storage-cleanup-last-run"
          title={t("settingsPages.storage.lastRun.title")}
          headerPlacement="inside"
          summary={lastRunSummary(
            t,
            summaries.filter(({ report }) => report !== null),
            connectedEnvironments.length,
          )}
        >
          {summaries.map(
            ({ environment, label, report }) =>
              report && (
                <CleanupResults
                  key={environment.environmentId}
                  report={report}
                  environmentLabel={label}
                />
              ),
          )}
        </FoldedSettingsSection>
      )}
    </SettingsSection>
  );
}

function supportsStorageCleanup(
  environments: ReadonlyArray<{
    readonly serverConfig: {
      readonly environment: { readonly capabilities: { readonly storageCleanup?: boolean } };
    } | null;
  }>,
) {
  return environments.every(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanup === true,
  );
}

/** Narrows a mixed selection to the machines that support cleanup. */
function StorageCleanupScopeNotice() {
  const t = useT();
  const { connectedEnvironments } = useSettingsScope();
  return (
    <SettingsScopeNotice
      inline
      target="environment"
      eligibleEnvironmentIds={connectedEnvironments
        .filter(
          (environment) =>
            environment.serverConfig?.environment.capabilities.storageCleanup === true,
        )
        .map((environment) => environment.environmentId)}
    >
      {t("settingsPages.storage.notice.storageCleanup")}
    </SettingsScopeNotice>
  );
}

export function WorktreeCleanupSection() {
  const t = useT();
  const { scope, environments, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? t("settingsPages.storage.mixedMachines")
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsSection
        id="storage-worktrees"
        title={t("settingsPages.storage.cleanup.section")}
        variant="plain"
      >
        <SettingsScopeNotice inline target="all">
          {t("settingsPages.storage.notice.projectCleanup")}
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }
  if (!supportsStorageCleanup(connectedEnvironments)) {
    return (
      <SettingsSection
        id="storage-worktrees"
        title={t("settingsPages.storage.cleanup.section")}
        variant="plain"
      >
        <StorageCleanupScopeNotice />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection id="storage-worktrees" title={t("settingsPages.storage.cleanup.section")}>
      <>
        {isProjectScope && (
          <SettingsRow
            title={t("settingsPages.storage.auto.title")}
            description={
              mode === "off"
                ? t("settingsPages.storage.auto.off")
                : mode === "custom"
                  ? t("settingsPages.storage.auto.custom")
                  : t("settingsPages.storage.auto.inherit")
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label={t("settingsPages.storage.auto.title")}>
                  <SelectValue>
                    {mixedModes
                      ? t("settings.common.mixed")
                      : mode === "inherit"
                        ? t("settingsPages.storage.mode.inherit")
                        : mode === "off"
                          ? t("settingsPages.storage.off")
                          : t("settingsPages.storage.mode.custom")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">{t("settingsPages.storage.mode.inherit")}</SelectItem>
                  <SelectItem value="off">{t("settingsPages.storage.off")}</SelectItem>
                  <SelectItem value="custom">{t("settingsPages.storage.mode.custom")}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title={t("settingsPages.storage.onDelete.title")}
              status={ruleStatus("worktreeOnDelete")}
              description={t("settingsPages.storage.onDelete.description")}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={t("settingsPages.storage.onDelete.title")}
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title={t("settingsPages.storage.merged.title")}
              status={ruleStatus("worktreeOnMerge")}
              description={t("settingsPages.storage.merged.description")}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={t("settingsPages.storage.merged.title")}
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title={t("settingsPages.storage.afterDays.title")}
              status={ruleStatus("worktreeAfterDays")}
              description={t("settingsPages.storage.afterDays.description")}
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label={t("settingsPages.storage.afterDays.title")}
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <AdvancedSettings
              // The keep-when search result lands on this section, not its row.
              targetIds={["storage-worktrees", searchableSetting("storage-worktree-keep-when").id]}
            >
              {connectedEnvironments.length > 0 &&
                connectedEnvironments.every(
                  (environment) =>
                    environment.serverConfig?.environment.capabilities.settledWorktreeCleanup ===
                    true,
                ) && (
                  <SettingsRow
                    title={t("settingsPages.storage.settled.title")}
                    status={[
                      ruleStatus("worktreeSettledAfterDays"),
                      environments.length > connectedEnvironments.length
                        ? t("settingsPages.storage.settled.offline")
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(". ")}
                    description={t("settingsPages.storage.settled.description")}
                    serverScoped={!isProjectScope}
                    control={
                      <RetentionControl
                        label={t("settingsPages.storage.settled.title")}
                        value={settings.worktreeSettledAfterDays}
                        minimum={0}
                        onChange={(worktreeSettledAfterDays) =>
                          updateWorktree({ worktreeSettledAfterDays })
                        }
                      />
                    }
                  />
                )}
              <SettingsRow
                title={t("settingsPages.storage.unchanged.title")}
                status={ruleStatus("worktreeUnchanged")}
                description={t("settingsPages.storage.unchanged.description")}
                serverScoped={!isProjectScope}
                control={
                  <Switch
                    aria-label={t("settingsPages.storage.unchanged.title")}
                    checked={settings.worktreeUnchanged}
                    onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                  />
                }
              />
              {connectedEnvironments.every(
                (environment) =>
                  environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
              ) && (
                <SettingsRow
                  {...searchableSetting("storage-worktree-keep-when")}
                  title={t("settingsPages.storage.keepWhen.title")}
                  status={ruleStatus("worktreeKeepWhen")}
                  description={t(
                    `settingsPages.storage.keepWhen.description.${settings.worktreeKeepWhen}`,
                  )}
                  serverScoped={!isProjectScope}
                  control={
                    <Select
                      value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                      onValueChange={(next) => {
                        if (
                          next === "any-local-files" ||
                          next === "uncommitted-changes" ||
                          next === "tracked-changes"
                        )
                          updateWorktree({ worktreeKeepWhen: next });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("settingsPages.storage.keepWhen.title")}
                      >
                        <SelectValue>
                          {ruleStatus("worktreeKeepWhen")
                            ? t("settings.common.mixed")
                            : t(`settingsPages.storage.keepWhen.${settings.worktreeKeepWhen}`)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        <SelectItem value="any-local-files">
                          {t("settingsPages.storage.keepWhen.any-local-files")}
                        </SelectItem>
                        <SelectItem value="uncommitted-changes">
                          {t("settingsPages.storage.keepWhen.uncommitted-changes")}
                        </SelectItem>
                        <SelectItem value="tracked-changes">
                          {t("settingsPages.storage.keepWhen.tracked-changes")}
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  }
                />
              )}
            </AdvancedSettings>
          </>
        )}
      </>
    </SettingsSection>
  );
}

/** Retention for logs and captures, and the manual cleanup run, which covers worktrees too. */
export function StorageCleanupSections() {
  const t = useT();
  const { scope, connectedEnvironments, targets } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  if (scope.kind === "project" || scope.kind === "checkout") return null;
  const settings = scopedSettings.storageCleanup;
  const ruleStatus = (key: "browserArtifactsAfterDays" | "logsAfterDays") =>
    targets.some((target) => target.settings.storageCleanup[key] !== settings[key])
      ? t("settingsPages.storage.mixedMachines")
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const databaseStorageNotice = (
    <DatabaseStorageNotice
      environments={connectedEnvironments.filter(
        (environment) =>
          environment.serverConfig?.environment.capabilities.databaseStorage === true,
      )}
    />
  );
  if (!supportsStorageCleanup(connectedEnvironments)) {
    return (
      <>
        {databaseStorageNotice}
        <SettingsSection
          id="storage-artifacts"
          title={t("settingsPages.storage.artifacts.section")}
          variant="plain"
        >
          <StorageCleanupScopeNotice />
        </SettingsSection>
      </>
    );
  }

  return (
    <>
      {databaseStorageNotice}
      <SettingsSection id="storage-artifacts" title={t("settingsPages.storage.artifacts.section")}>
        <SettingsRow
          title={t("settingsPages.storage.browserArtifacts.title")}
          status={ruleStatus("browserArtifactsAfterDays")}
          description={t("settingsPages.storage.browserArtifacts.description")}
          serverScoped
          control={
            <RetentionControl
              label={t("settingsPages.storage.browserArtifacts.title")}
              value={settings.browserArtifactsAfterDays}
              onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
            />
          }
        />
        <SettingsRow
          title={t("settingsPages.storage.logs.title")}
          status={ruleStatus("logsAfterDays")}
          description={t("settingsPages.storage.logs.description")}
          serverScoped
          control={
            <RetentionControl
              label={t("settingsPages.storage.logs.title")}
              value={settings.logsAfterDays}
              onChange={(logsAfterDays) => update({ logsAfterDays })}
            />
          }
        />
      </SettingsSection>
      <CleanupSection />
    </>
  );
}
