import type { AnyRouter } from "@tanstack/react-router";
import type { AssistantClockStatus, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { getClientSettings } from "../../hooks/useSettings";
import { t } from "../../i18n";
import { assistantEnvironment } from "../../state/assistant";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../../threadNotifications";
import { toastManager } from "../ui/toast";

// setTimeout fires immediately for delays beyond a signed 32-bit int.
const MAX_TIMEOUT_MS = 2_147_483_647;
const ASSISTANT_PATH = "/assistant";

/** How long until the end-of-day reminder, or null when none is due for this workday. */
export function reminderDelayMs(
  status: AssistantClockStatus | null,
  nowMs: number,
  firedFor: ReadonlySet<string>,
): number | null {
  if (status === null || status.activeStart === null || status.expectedEnd === null) return null;
  if (firedFor.has(status.reportDate)) return null;
  return Math.max(0, Date.parse(status.expectedEnd) - nowMs);
}

function presentReminder(router: AnyRouter) {
  const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
  if (hasNotificationSound(mode)) {
    void playNotificationSound("completion", () =>
      hasNotificationSound(getClientSettings().notificationMode),
    );
  }
  const title = t("assistantPage.reminder.title");
  const body = t("assistantPage.reminder.body");
  const openAssistant = () => void router.navigate({ to: ASSISTANT_PATH });
  const focused = document.visibilityState === "visible" && document.hasFocus();
  if (inAppNotificationsEnabled && focused) {
    const onAssistantPage = router.state.location.pathname === ASSISTANT_PATH;
    const toastId: ReturnType<typeof toastManager.add> = toastManager.add({
      type: "info",
      title,
      description: body,
      ...(onAssistantPage
        ? {}
        : {
            actionProps: {
              children: t("assistantPage.open"),
              onClick: () => {
                toastManager.close(toastId);
                openAssistant();
              },
            },
          }),
    });
    return;
  }
  if (
    !hasDesktopNotifications(mode) ||
    focused ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const notification = new Notification(title, {
      body,
      tag: "t3-assistant-reminder",
      silent: true,
    });
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
      void window.desktopBridge?.revealWindow().catch(() => undefined);
      openAssistant();
    });
  } catch {
    // Some browsers expose Notification but reject desktop presentation.
  }
}

/** Refetches a query that already settled; one still loading is fresh enough. */
function refreshSettled(registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) {
  const atom = assistantEnvironment.clockStatus({ environmentId, input: {} });
  const current = registry.get(atom);
  if (current._tag !== "Initial" && !current.waiting) registry.refresh(atom);
}

/**
 * Keeps the primary environment's clock status loaded for the sidebar and schedules the
 * end-of-day reminder from it. ERP is read on start and when the window comes back, never polled.
 */
export function startAssistantClockSync(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): void {
  // In memory, so each open client reminds once per workday.
  const firedFor = new Set<string>();
  let environmentId: EnvironmentId | null = null;
  let status: AssistantClockStatus | null = null;
  let reminder: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeClock = () => {};

  const scheduleReminder = () => {
    clearTimeout(reminder);
    reminder = undefined;
    const delay = reminderDelayMs(status, Date.now(), firedFor);
    if (delay === null) return;
    reminder = setTimeout(
      () => {
        reminder = undefined;
        // A capped delay wakes early; re-check against the clock instead of firing.
        const due = reminderDelayMs(status, Date.now(), firedFor);
        if (due === null) return;
        if (due > 0) {
          scheduleReminder();
          return;
        }
        if (status !== null) firedFor.add(status.reportDate);
        presentReminder(router);
      },
      Math.min(delay, MAX_TIMEOUT_MS),
    );
  };

  registry.subscribe(
    primaryEnvironmentIdAtom,
    (next) => {
      if (next === environmentId) return;
      unsubscribeClock();
      unsubscribeClock = () => {};
      environmentId = next;
      status = null;
      scheduleReminder();
      if (next === null) return;
      unsubscribeClock = registry.subscribe(
        assistantEnvironment.clockStatus({ environmentId: next, input: {} }),
        (result) => {
          status = AsyncResult.getOrElse(result, () => null);
          scheduleReminder();
        },
        { immediate: true },
      );
      refreshSettled(registry, next);
    },
    { immediate: true },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    scheduleReminder();
    if (environmentId !== null) refreshSettled(registry, environmentId);
  });
}
