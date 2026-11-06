import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AssistantErpBaseUrl,
  AssistantError,
  AuthSettingsWriteScope,
  DEFAULT_ASSISTANT_MODEL_SELECTION,
  type EnvironmentId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { Navigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useT } from "~/i18n";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { assistantEnvironment } from "../../state/assistant";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { expectsPrimaryEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastCommandFailure } from "../assistant/AssistantClockBar";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { SecretInput } from "./SecretInput";
import { searchableSetting } from "./settingsSearch";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const ERP_TOKEN_SCOPE_KEYS = [
  "assistantPage.settings.scope.attendance",
  "assistantPage.settings.scope.dailyReports",
  "assistantPage.settings.scope.dailyReportsWrite",
  "assistantPage.settings.scope.directory",
] as const;
const isAssistantError = Schema.is(AssistantError);
const isAssistantErpBaseUrl = Schema.is(AssistantErpBaseUrl);
// Only Claude reads the assistant memory (CLAUDE.md). The default selection uses Claude's
// default instance, whose id is its driver kind (see `defaultInstanceIdForDriver`).
const ASSISTANT_PROVIDER = ProviderDriverKind.make(DEFAULT_ASSISTANT_MODEL_SELECTION.instanceId);

// Mirrors the server, which stores the URL without trailing slashes.
const normalizeErpBaseUrl = (value: string) => value.trim().replace(/\/+$/u, "");

/** The assistant lives on the primary environment only. */
export function AssistantSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId !== null) return <AssistantSettingsContent environmentId={environmentId} />;
  // Primary discovery is async, so a reload here waits for it instead of leaving the page.
  if (expectsPrimaryEnvironment()) return null;
  return <Navigate to="/settings/general" replace />;
}

function AssistantSettingsContent({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useT();
  const settings = useEnvironmentSettings(environmentId);
  const assistant = settings.assistant;
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, null);
  const selection = assistant.modelSelection ?? DEFAULT_ASSISTANT_MODEL_SELECTION;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection.instanceId,
    selection.model,
  );
  const PermissionIcon = runtimeModeConfig[assistant.runtimeMode].icon;

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("assistantPage.title")} hideTitle>
        <ErpConnectionRows
          environmentId={environmentId}
          savedUrl={assistant.erpBaseUrl}
          tokenSaved={assistant.erpToken !== ""}
          canWrite={canWrite}
        />
        <SettingsRow
          id={searchableSetting("assistant-model").id}
          title={t("assistantPage.settings.model")}
          control={
            <ProviderModelPicker
              environmentId={environmentId}
              disabled={!canWrite}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={ASSISTANT_PROVIDER}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              triggerAriaLabel={t("assistantPage.settings.model")}
              onInstanceModelChange={(instanceId, model) =>
                updateSettings({
                  assistant: { modelSelection: createModelSelection(instanceId, model) },
                })
              }
            />
          }
        />
        <SettingsRow
          id={searchableSetting("assistant-runtime-mode").id}
          title={t("assistantPage.settings.runtimeMode")}
          control={
            <Select
              value={assistant.runtimeMode}
              disabled={!canWrite}
              onValueChange={(value) => {
                if (value) updateSettings({ assistant: { runtimeMode: value } });
              }}
            >
              <SelectTrigger size="sm" aria-label={t("assistantPage.settings.runtimeMode")}>
                <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue>
                  {t(`composer.runtimeMode.${assistant.runtimeMode}.label`)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {runtimeModeOptions.map((mode) => {
                  const Icon = runtimeModeConfig[mode].icon;
                  return (
                    <SelectItem key={mode} value={mode} className="min-w-64">
                      <div className="grid gap-0.5">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          {t(`composer.runtimeMode.${mode}.label`)}
                        </span>
                        <span className="text-xs leading-4 text-muted-foreground">
                          {t(`composer.runtimeMode.${mode}.description`)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          id={searchableSetting("assistant-memory").id}
          title={t("assistantPage.settings.memory")}
          control={<AssistantMemoryDialog environmentId={environmentId} />}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ErpConnectionRows(props: {
  readonly environmentId: EnvironmentId;
  readonly savedUrl: string;
  readonly tokenSaved: boolean;
  readonly canWrite: boolean;
}) {
  const t = useT();
  const save = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save assistant ERP connection",
    reportFailure: false,
  });
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = urlDraft ?? props.savedUrl;
  const urlChanged = normalizeErpBaseUrl(url) !== props.savedUrl;
  const token = tokenDraft.trim();
  const disabled = !props.canWrite || saving;

  const submit = async () => {
    // The same contract schema the server decodes with, checked here so the message is localized.
    if (!isAssistantErpBaseUrl(url.trim())) {
      setError(t("assistantPage.settings.erpUrlNotHttps"));
      return;
    }
    // Without a URL the token is never used, and the page would report it as missing.
    if (url.trim() === "" && token !== "") {
      setError(t("assistantPage.settings.erpUrlRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await save({
      environmentId: props.environmentId,
      input: {
        patch: {
          assistant: {
            erpBaseUrl: url.trim(),
            // The saved token belongs to the old ERP host; the server clears it too.
            ...(token !== "" ? { erpToken: token } : urlChanged ? { erpToken: "" } : {}),
          },
        },
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setUrlDraft(null);
      setTokenDraft("");
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    // Schema issues put the field path on the lines after the message.
    setError((failure instanceof Error ? failure.message : String(failure)).split("\n")[0] ?? "");
  };

  return (
    <>
      <SettingsRow
        id={searchableSetting("assistant-erp-url").id}
        title={t("assistantPage.settings.erpUrl")}
        status={error === null ? null : <span className="text-destructive">{error}</span>}
        control={
          <Input
            size="sm"
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://erp.example.com"
            aria-label={t("assistantPage.settings.erpUrl")}
            aria-invalid={error === null ? undefined : true}
            disabled={disabled}
            value={url}
            onChange={(event) => {
              setUrlDraft(event.target.value);
              setError(null);
            }}
          />
        }
      />
      <SettingsRow
        id={searchableSetting("assistant-erp-token").id}
        title={t("assistantPage.settings.erpToken")}
        description={
          <>
            {t("assistantPage.settings.erpTokenHelp")}
            {/* The row renders its description inside a <p>, which cannot hold a list. */}
            {ERP_TOKEN_SCOPE_KEYS.map((key) => (
              <span key={key} className="block ps-2">
                • {t(key)}
              </span>
            ))}
          </>
        }
        control={
          <div className="flex w-full items-center gap-2">
            <SecretInput
              size="sm"
              className="min-w-0 flex-1"
              aria-label={t("assistantPage.settings.erpToken")}
              configured={props.tokenSaved && !urlChanged}
              disabled={disabled}
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <Button
              size="sm"
              disabled={disabled || (!urlChanged && token === "")}
              onClick={() => void submit()}
            >
              {saving ? <Spinner /> : null}
              {t("assistantPage.settings.save")}
            </Button>
          </div>
        }
      />
    </>
  );
}

function AssistantMemoryDialog({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useT();
  const canOperate = useAtomValue(assistantEnvironment.writeMemory.permissionAtom(environmentId));
  const readMemory = useAtomCommand(assistantEnvironment.readMemory, { reportFailure: false });
  const writeMemory = useAtomCommand(assistantEnvironment.writeMemory, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"readFailed" | "writeFailed" | null>(null);

  const isMemoryIo = (failure: unknown) =>
    isAssistantError(failure) && failure.reason === "memory-io";

  const load = async () => {
    setContent(null);
    setError(null);
    setOpen(true);
    setLoading(true);
    const result = await readMemory({ environmentId, input: {} });
    setLoading(false);
    if (result._tag === "Success") {
      setContent(result.value.content);
      return;
    }
    if (result._tag === "Failure" && isMemoryIo(squashAtomCommandFailure(result))) {
      setError("readFailed");
      return;
    }
    setOpen(false);
    toastCommandFailure(result, t);
  };

  const submit = async () => {
    if (content === null) return;
    setSaving(true);
    setError(null);
    const result = await writeMemory({ environmentId, input: { content } });
    setSaving(false);
    if (result._tag === "Success") {
      setOpen(false);
      return;
    }
    if (result._tag === "Failure" && isMemoryIo(squashAtomCommandFailure(result))) {
      setError("writeFailed");
      return;
    }
    toastCommandFailure(result, t);
  };

  return (
    <>
      <Button size="sm" variant="outline" disabled={!canOperate} onClick={() => void load()}>
        {t("assistantPage.settings.memory")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("assistantPage.settings.memory")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {loading ? (
              <Spinner />
            ) : (
              <Textarea
                aria-label={t("assistantPage.settings.memory")}
                disabled={content === null || saving}
                value={content ?? ""}
                onChange={(event) => setContent(event.target.value)}
              />
            )}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {t(`assistantPage.memory.${error}`)}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose disabled={saving} render={<Button variant="outline" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              disabled={!canOperate || content === null || saving}
              onClick={() => void submit()}
            >
              {saving ? <Spinner /> : null}
              {t("assistantPage.settings.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
