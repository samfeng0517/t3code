import type { EnvironmentId, SecretReference, UnifiedSettings } from "@t3tools/contracts";
import { useState } from "react";

import { useT } from "~/i18n";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { sourceIdFromUrl } from "./AddUsageLimitSourceDialog.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { Label } from "../ui/label";

/** Send the management key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
}) {
  const t = useT();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const secretSources = useSecretSources(environmentId);
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>("");
  const managementKey = typeof keyDraft === "string" ? keyDraft.trim() : keyDraft;
  const trimmedUrl = url.trim();
  const canSave = trimmedUrl.length > 0 && managementKey !== "";

  const reset = () => {
    setLabel("");
    setUrl("");
    setKeyDraft("");
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, sources);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind: "cliproxy",
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey,
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settingsProviders.usageLimitSource.title")}</DialogTitle>
          <DialogDescription>
            {t("settingsProviders.usageLimitSource.description", {
              environment: environmentLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {t("settingsProviders.usageLimitSource.url")}
              </Label>
              <Input
                id="usage-source-url"
                placeholder="https://hub.example.ts.net:8318"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {t("settingsProviders.usageLimitSource.managementKey")}
              </Label>
              <SecretSourceInput
                id="usage-source-key"
                aria-label={t("settingsProviders.usageLimitSource.managementKey")}
                value={keyDraft}
                sources={secretSources}
                onChange={(event) => setKeyDraft(event.target.value)}
                onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                onProviderPick={() => setKeyDraft("")}
                onReferenceReject={() => setKeyDraft("")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">
                {t("settingsProviders.usageLimitSource.label")}
              </Label>
              <Input
                id="usage-source-label"
                placeholder={t("settingsProviders.usageLimitSource.labelPlaceholder")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {t("settingsProviders.usageLimitSource.cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {t("settingsProviders.usageLimitSource.add")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
