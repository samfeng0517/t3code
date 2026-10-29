import { useAtomValue } from "@effect/atom-react";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import {
  pullRequestRoutingConnectionKey,
  pullRequestRoutingPermissionFor,
  type PullRequestRoutingPermission,
} from "@t3tools/client-runtime/connection";
import { useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useT, type MessageKey, type Translate } from "~/i18n";
import type { EnvironmentPresentation } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const optionKeys: ReadonlyArray<{ value: PullRequestRoutingPermission; label: MessageKey }> = [
  { value: "off", label: "settingsMisc.prRouting.off" },
  { value: "read", label: "settingsMisc.prRouting.readPrs" },
  { value: "read-write", label: "settingsMisc.prRouting.readAndAct" },
];

const summaryKeys = {
  "read-write": "settingsMisc.prRouting.summary.readWrite",
  read: "settingsMisc.prRouting.summary.read",
} as const;

function summarizePullRequestRouting(
  entries: ReadonlyArray<{
    readonly label: string;
    readonly permission: PullRequestRoutingPermission;
  }>,
  t: Translate,
): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0
      ? []
      : [t(summaryKeys[permission], { labels: labels.map((entry) => entry.label).join(", ") })];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export function PullRequestRoutingSettings({
  environments,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const permissions = useAtomValue(environmentCatalog.pullRequestRoutingPermissionsValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const update = useAtomCommand(environmentCatalog.setPullRequestRoutingPermission);
  const [saving, setSaving] = useState(false);
  const t = useT();

  if (environments.length < 2) return null;

  const options = optionKeys.map(({ value, label }) => ({ value, label: t(label) }));
  const { id, title } = searchableSetting("pull-request-routing", t);
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        summarizePullRequestRouting(
          environments.map((environment) => ({
            label: environment.label,
            permission: pullRequestRoutingPermissionFor(environment.entry, permissions),
          })),
          t,
        ) ?? t("settingsMisc.prRouting.off")
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        {t("settingsMisc.prRouting.description")}
      </p>
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={environmentTransportLabel(environment, null, t)}
        >
          <Select
            items={options}
            value={pullRequestRoutingPermissionFor(environment.entry, permissions)}
            disabled={
              !catalog.isReady ||
              saving ||
              pullRequestRoutingConnectionKey(environment.entry) === null
            }
            onValueChange={(permission) => {
              if (permission === null) return;
              setSaving(true);
              void update({ environmentId: environment.environmentId, permission }).then(
                (result) => {
                  setSaving(false);
                  if (result._tag === "Failure")
                    toastManager.add({
                      type: "error",
                      title: t("settingsMisc.prRouting.saveFailed"),
                    });
                },
              );
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-32"
              aria-label={t("settingsMisc.prRouting.ariaLabel", { environment: environment.label })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
