import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { useT } from "~/i18n";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const NOTIFICATION_MODES = ["off", "notifications", "sound", "notifications-and-sound"] as const;

export function NotificationSettings() {
  const t = useT();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      title={t("settingsProviders.notifications.title")}
      description={permissionMessage ?? t("settingsProviders.notifications.description")}
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(t("settingsProviders.notifications.permission.unsupported"));
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(t("settingsProviders.notifications.permission.unavailable"));
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(t("settingsProviders.notifications.permission.denied"));
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={t("settingsProviders.notifications.title")}
          >
            <SelectValue>{t(`settingsProviders.notifications.mode.${mode}`)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {NOTIFICATION_MODES.map((value) => (
              <SelectItem key={value} hideIndicator value={value}>
                {t(`settingsProviders.notifications.mode.${value}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
