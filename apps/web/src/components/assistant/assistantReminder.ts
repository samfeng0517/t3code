import type { AnyRouter } from "@tanstack/react-router";
import type { AssistantClockStatus, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";

import { getClientSettings } from "../../hooks/useSettings";
import { t } from "../../i18n";
import { assistantEnvironment, refreshSettled } from "../../state/assistant";
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

/**
 * Keeps one environment's clock status loaded and schedules the end-of-day reminder from it.
 * Returns the handler for the window coming back to the foreground.
 */
export function trackAssistantClock<E>(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly environmentId: Atom.Atom<EnvironmentId | null>;
  readonly clockStatus: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AssistantClockStatus, E>>;
  readonly remind: () => void;
}): () => void {
  const { registry, clockStatus, remind } = options;
  // In memory, so each open client reminds once per workday.
  const firedFor = new Set<string>();
  let environmentId: EnvironmentId | null = null;
  let status: AssistantClockStatus | null = null;
  let reminder: ReturnType<typeof setTimeout> | undefined;
  // Set while the due reminder waits for one fresh read; the user may have clocked out elsewhere.
  let awaitingFreshStatus = false;
  let unsubscribeClock = () => {};

  const remindIfDue = () => {
    const due = reminderDelayMs(status, Date.now(), firedFor);
    if (due === null) return;
    if (due > 0) {
      scheduleReminder();
      return;
    }
    if (status !== null) firedFor.add(status.reportDate);
    remind();
  };

  const scheduleReminder = () => {
    clearTimeout(reminder);
    reminder = undefined;
    if (awaitingFreshStatus) return;
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
        if (environmentId === null) return;
        const atom = clockStatus(environmentId);
        awaitingFreshStatus = true;
        refreshSettled(registry, atom);
        // A read that settles synchronously to an equal value notifies no subscriber.
        if (awaitingFreshStatus) onClockResult(registry.get(atom));
      },
      Math.min(delay, MAX_TIMEOUT_MS),
    );
  };

  const onClockResult = (result: AsyncResult.AsyncResult<AssistantClockStatus, E>) => {
    if (!awaitingFreshStatus) {
      status = AsyncResult.getOrElse(result, () => null);
      scheduleReminder();
      return;
    }
    if (result._tag === "Initial" || result.waiting) return;
    awaitingFreshStatus = false;
    // A failed read keeps the last status, so the reminder still fires.
    if (result._tag === "Success") status = result.value;
    remindIfDue();
  };

  registry.subscribe(
    options.environmentId,
    (next) => {
      if (next === environmentId) return;
      unsubscribeClock();
      unsubscribeClock = () => {};
      environmentId = next;
      status = null;
      awaitingFreshStatus = false;
      scheduleReminder();
      if (next === null) return;
      unsubscribeClock = registry.subscribe(clockStatus(next), onClockResult, {
        immediate: true,
      });
      refreshSettled(registry, clockStatus(next));
    },
    { immediate: true },
  );

  return () => {
    scheduleReminder();
    if (environmentId !== null) refreshSettled(registry, clockStatus(environmentId));
  };
}

/**
 * Keeps the primary environment's clock status loaded for the sidebar and schedules the
 * end-of-day reminder from it. ERP is read on start and when the window comes back, never polled.
 */
export function startAssistantClockSync(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): void {
  const onVisible = trackAssistantClock({
    registry,
    environmentId: primaryEnvironmentIdAtom,
    clockStatus: (environmentId) => assistantEnvironment.clockStatus({ environmentId, input: {} }),
    remind: () => presentReminder(router),
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onVisible();
  });
}
