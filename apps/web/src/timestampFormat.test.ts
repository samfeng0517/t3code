import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setLanguagePreference } from "./i18n/languagePreferenceStore";
import {
  formatDayAwareTimestamp,
  formatElapsedDurationLabel,
  formatExpiresInLabel,
  formatRelativeElapsed,
  formatRelativeTimeLabel,
  formatUpcomingTimestamp,
} from "./timestampFormat";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function from(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  setLanguagePreference("system");
});

describe("relative time labels (en)", () => {
  it("keeps the compact English output", () => {
    setLanguagePreference("en");
    expect(formatRelativeTimeLabel(ago(10_000), NOW)).toBe("just now");
    expect(formatRelativeTimeLabel(ago(5 * MINUTE), NOW)).toBe("5m ago");
    expect(formatRelativeTimeLabel(ago(2 * HOUR), NOW)).toBe("2h ago");
    expect(formatRelativeTimeLabel(ago(3 * DAY), NOW)).toBe("3d ago");
    expect(formatRelativeElapsed(5 * MINUTE)).toEqual({ value: "5m", suffix: "ago" });
    expect(formatRelativeElapsed(1_000)).toEqual({ value: "just now", suffix: null });
  });

  it("formats elapsed durations and expiry labels", () => {
    setLanguagePreference("en");
    expect(formatElapsedDurationLabel(ago(2_000), NOW)).toBe("just now");
    expect(formatElapsedDurationLabel(ago(30_000), NOW)).toBe("30s");
    expect(formatElapsedDurationLabel(ago(4 * HOUR), NOW)).toBe("4h");
    expect(formatExpiresInLabel(from(-1), NOW)).toBe("Expired");
    expect(formatExpiresInLabel(from(2_000), NOW)).toBe("Expires in a moment");
    expect(formatExpiresInLabel(from(45_000), NOW)).toBe("Expires in 45s");
    expect(formatExpiresInLabel(from(5 * MINUTE), NOW)).toBe("Expires in 5m");
    expect(formatExpiresInLabel(from(5 * MINUTE + 30_000), NOW)).toBe("Expires in 5m 30s");
    expect(formatExpiresInLabel(from(2 * HOUR + 3 * MINUTE), NOW)).toBe("Expires in 2h 3m");
    expect(formatExpiresInLabel(from(DAY), NOW)).toBe("Expires in 1d");
    expect(formatExpiresInLabel(from(DAY + 2 * HOUR + 4_000), NOW)).toBe("Expires in 1d 2h 4s");
  });
});

describe("relative time labels (zh-TW)", () => {
  it("uses Taiwan wording", () => {
    setLanguagePreference("zh-TW");
    expect(formatRelativeTimeLabel(ago(10_000), NOW)).toBe("剛剛");
    expect(formatRelativeTimeLabel(ago(5 * MINUTE), NOW)).toBe("5 分鐘前");
    expect(formatRelativeTimeLabel(ago(2 * HOUR), NOW)).toBe("2 小時前");
    expect(formatRelativeTimeLabel(ago(3 * DAY), NOW)).toBe("3 天前");
  });

  it("keeps a null suffix only for the just-now label", () => {
    setLanguagePreference("zh-TW");
    expect(formatRelativeElapsed(1_000).suffix).toBeNull();
    expect(formatRelativeElapsed(5 * MINUTE).suffix).toBe("");
  });

  it("formats elapsed durations and expiry labels", () => {
    setLanguagePreference("zh-TW");
    expect(formatElapsedDurationLabel(ago(30_000), NOW)).toBe("30 秒");
    expect(formatElapsedDurationLabel(ago(4 * HOUR), NOW)).toBe("4 小時");
    expect(formatExpiresInLabel(from(-1), NOW)).toBe("已過期");
    expect(formatExpiresInLabel(from(2_000), NOW)).toBe("即將到期");
    expect(formatExpiresInLabel(from(5 * MINUTE + 30_000), NOW)).toBe("5 分鐘 30 秒後到期");
    expect(formatExpiresInLabel(from(DAY + 2 * HOUR), NOW)).toBe("1 天 2 小時後到期");
  });
});

describe("day-relative timestamps", () => {
  it("localizes the yesterday and tomorrow prefixes", () => {
    const noon = new Date(2026, 5, 15, 12, 0, 0).getTime();
    const yesterday = new Date(2026, 5, 14, 9, 30, 0).toISOString();
    const tomorrow = new Date(2026, 5, 16, 9, 30, 0).toISOString();
    setLanguagePreference("en");
    expect(formatDayAwareTimestamp(yesterday, "24-hour", noon)).toMatch(/^yesterday at /);
    expect(formatUpcomingTimestamp(tomorrow, "24-hour", noon)).toMatch(/^tomorrow at /);
    setLanguagePreference("zh-TW");
    expect(formatDayAwareTimestamp(yesterday, "24-hour", noon)).toMatch(/^昨天 /);
    expect(formatUpcomingTimestamp(tomorrow, "24-hour", noon)).toMatch(/^明天 /);
  });
});
