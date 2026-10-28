import { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "limits", windowDays: 30 };

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema) ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}

type UsageMetric = UsagePagePreferences["metric"];
const metricRequestListeners = new Set<(metric: UsageMetric) => void>();

/** Opens the page on `metric` next mount, and switches an already open page too. */
export function requestUsagePageMetric(metric: UsageMetric): void {
  saveUsagePagePreferences({ ...readUsagePagePreferences(), metric });
  for (const listener of metricRequestListeners) listener(metric);
}

export function subscribeUsagePageMetricRequests(
  listener: (metric: UsageMetric) => void,
): () => void {
  metricRequestListeners.add(listener);
  return () => {
    metricRequestListeners.delete(listener);
  };
}
