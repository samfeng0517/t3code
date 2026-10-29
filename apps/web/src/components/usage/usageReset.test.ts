import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { t } from "~/i18n";
import { setLanguagePreference } from "~/i18n/languagePreferenceStore";
import { formatUsageResetsIn } from "./usageReset";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const windowResettingIn = (ms: number): ServerProviderUsageWindow => ({
  id: "five_hour",
  kind: "session",
  label: "5-hour",
  usedPercent: 10,
  resetsAt: new Date(NOW + ms).toISOString(),
});

describe("formatUsageResetsIn", () => {
  beforeEach(() => setLanguagePreference("en"));

  it("should match the shared English countdown when the locale is English", () => {
    for (const offset of [
      -HOUR,
      0,
      30_000,
      MINUTE,
      59 * MINUTE,
      2 * HOUR + 26 * MINUTE,
      3 * DAY + 5 * HOUR,
    ]) {
      const window = windowResettingIn(offset);
      expect(formatUsageResetsIn(t, window, NOW)).toBe(formatResetsIn(window, NOW));
    }
  });

  it("should derive the compact and inline English forms from the full countdown", () => {
    const window = windowResettingIn(2 * HOUR + 26 * MINUTE);
    expect(formatUsageResetsIn(t, window, NOW, "arrow")).toBe("↻ 2h 26m");
    expect(formatUsageResetsIn(t, window, NOW, "inline")).toBe("in 2h 26m");
    expect(formatUsageResetsIn(t, windowResettingIn(30_000), NOW, "arrow")).toBe(
      "Resets momentarily",
    );
  });

  it("should return null when the window has no reset time", () => {
    const { resetsAt: _resetsAt, ...window } = windowResettingIn(HOUR);
    expect(formatUsageResetsIn(t, window, NOW)).toBeNull();
  });

  it("should use the sidebar wording when the locale is zh-TW", () => {
    setLanguagePreference("zh-TW");
    expect(formatUsageResetsIn(t, windowResettingIn(2 * HOUR + 26 * MINUTE), NOW)).toBe(
      "2 小時 26 分後重設",
    );
    expect(formatUsageResetsIn(t, windowResettingIn(2 * HOUR + 26 * MINUTE), NOW, "arrow")).toBe(
      "↻ 2 小時 26 分",
    );
    expect(formatUsageResetsIn(t, windowResettingIn(3 * DAY + 5 * HOUR), NOW, "inline")).toBe(
      "3 天 5 小時後",
    );
  });
});
