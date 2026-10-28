import type { RelayClientDeviceRecord } from "@t3tools/contracts/relay";

import { t } from "../../i18n";

const mobileClientUpdatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const NOTIFICATION_PREFERENCES = [
  ["notifyOnApproval", "onboarding.mobileClients.notifications.approvals"],
  ["notifyOnInput", "onboarding.mobileClients.notifications.inputRequests"],
  ["notifyOnCompletion", "onboarding.mobileClients.notifications.completions"],
  ["notifyOnFailure", "onboarding.mobileClients.notifications.failures"],
] as const satisfies ReadonlyArray<
  readonly [keyof RelayClientDeviceRecord["notifications"], string]
>;

export function mobileClientPlatformLabel(device: RelayClientDeviceRecord): string {
  const platform =
    device.platform === "android"
      ? "Android"
      : device.iosMajorVersion === null
        ? "iOS"
        : `iOS ${device.iosMajorVersion}`;
  return `${platform}${device.appVersion ? ` · T3 Code ${device.appVersion}` : ""}`;
}

export function mobileClientNotificationDetail(device: RelayClientDeviceRecord): string {
  if (!device.notifications.enabled) {
    return t("onboarding.mobileClients.notifications.disabled");
  }

  const enabledPreferences = NOTIFICATION_PREFERENCES.flatMap(([preference, labelKey]) =>
    device.notifications[preference] ? [t(labelKey)] : [],
  );
  return enabledPreferences.length > 0
    ? t("onboarding.mobileClients.notifications.alertsFor", {
        types: enabledPreferences.join(t("onboarding.listSeparator")),
      })
    : t("onboarding.mobileClients.notifications.noTypes");
}

export function mobileClientUpdatedAtLabel(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime())
    ? t("onboarding.mobileClients.updatedUnavailable")
    : t("onboarding.mobileClients.updated", { date: mobileClientUpdatedAtFormatter.format(date) });
}
