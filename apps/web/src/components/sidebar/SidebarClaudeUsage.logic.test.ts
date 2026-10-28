import {
  ProviderDriverKind,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  claudeUsageTone,
  resetCountdown,
  resolveClaudeUsageRows,
  resolveSidebarClaudeUsage,
} from "./SidebarClaudeUsage.logic";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function at(offset: number): string {
  return new Date(NOW + offset).toISOString();
}

function sessionWindow(usedPercent: number, resetsIn?: number): ServerProviderUsageWindow {
  return {
    id: "five_hour",
    kind: "session",
    label: "Session",
    usedPercent,
    windowDurationMins: 300,
    ...(resetsIn === undefined ? {} : { resetsAt: at(resetsIn) }),
  };
}

function weeklyWindow(usedPercent: number, resetsIn?: number): ServerProviderUsageWindow {
  return {
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    usedPercent,
    windowDurationMins: 7 * 24 * 60,
    ...(resetsIn === undefined ? {} : { resetsAt: at(resetsIn) }),
  };
}

function claude(
  windows: ServerProviderUsageWindow[],
  extra: Partial<ServerProviderUsageLimits> = {},
  driver = "claudeAgent",
) {
  return {
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    usageLimits: { checkedAt: at(-MINUTE), windows, ...extra },
  };
}

describe("claudeUsageTone", () => {
  it("warns from 75% and turns critical from 90%", () => {
    expect(claudeUsageTone(74)).toBe("normal");
    expect(claudeUsageTone(75)).toBe("warning");
    expect(claudeUsageTone(89)).toBe("warning");
    expect(claudeUsageTone(90)).toBe("critical");
  });
});

function modelWindow(usedPercent: number, resetsIn?: number): ServerProviderUsageWindow {
  return {
    id: "seven_day_sonnet",
    kind: "weekly",
    label: "Weekly · Sonnet",
    usedPercent,
    windowDurationMins: 7 * 24 * 60,
    ...(resetsIn === undefined ? {} : { resetsAt: at(resetsIn) }),
  };
}

describe("resolveClaudeUsageRows", () => {
  it("should list the 5-hour, weekly, and model-scoped windows in that order when all are reported", () => {
    const rows = resolveClaudeUsageRows(
      claude([
        modelWindow(12.2, 3 * 24 * HOUR),
        weeklyWindow(40.4, 3 * 24 * HOUR),
        sessionWindow(42.6, 2 * HOUR),
      ]),
      NOW,
    );
    expect(rows).toEqual([
      { kind: "session", reading: { usedPercent: 43, resetsAt: NOW + 2 * HOUR, tone: "normal" } },
      {
        kind: "weekly",
        reading: { usedPercent: 40, resetsAt: NOW + 3 * 24 * HOUR, tone: "normal" },
      },
      {
        kind: "model",
        model: "Sonnet",
        reading: { usedPercent: 12, resetsAt: NOW + 3 * 24 * HOUR, tone: "normal" },
      },
    ]);
  });

  it("should give each window its own tone when only one is nearly spent", () => {
    const rows = resolveClaudeUsageRows(
      claude([sessionWindow(10, HOUR), weeklyWindow(92, HOUR), modelWindow(80, HOUR)]),
      NOW,
    );
    expect(rows?.map((row) => row.reading.tone)).toEqual(["normal", "critical", "warning"]);
  });

  it("should skip windows the account does not report when only some are present", () => {
    const rows = resolveClaudeUsageRows(claude([weeklyWindow(50, HOUR)]), NOW);
    expect(rows?.map((row) => row.kind)).toEqual(["weekly"]);
  });

  it("should not count monthly spend when it is the only other window", () => {
    const rows = resolveClaudeUsageRows(
      claude([
        sessionWindow(10, HOUR),
        { id: "monthly_spend", kind: "monthly", label: "Monthly spend", usedPercent: 50 },
      ]),
      NOW,
    );
    expect(rows?.map((row) => row.kind)).toEqual(["session"]);
  });

  it("should report a refilled window without a countdown when its reset time has passed", () => {
    const rows = resolveClaudeUsageRows(claude([sessionWindow(97, -MINUTE)]), NOW);
    expect(rows?.[0]?.reading).toEqual({ usedPercent: 0, resetsAt: null, tone: "normal" });
  });

  it("should return null when the provider is not an enabled Claude with readable limits", () => {
    expect(resolveClaudeUsageRows(claude([sessionWindow(50)], {}, "codex"), NOW)).toBeNull();
    expect(
      resolveClaudeUsageRows({ ...claude([sessionWindow(50)]), enabled: false }, NOW),
    ).toBeNull();
    expect(
      resolveClaudeUsageRows(
        claude([sessionWindow(50)], { unavailable: { reason: "unsupported" } }),
        NOW,
      ),
    ).toBeNull();
    expect(resolveClaudeUsageRows(claude([]), NOW)).toBeNull();
    expect(resolveClaudeUsageRows(null, NOW)).toBeNull();
  });
});

describe("resolveSidebarClaudeUsage", () => {
  it("should use the first Claude instance with limits when earlier providers have none", () => {
    const rows = resolveSidebarClaudeUsage(
      [
        claude([sessionWindow(90)], {}, "codex"),
        { ...claude([sessionWindow(80)]), enabled: false },
        claude([sessionWindow(20)]),
        claude([sessionWindow(60)]),
      ],
      NOW,
    );
    expect(rows?.[0]?.reading.usedPercent).toBe(20);
  });
});

describe("resetCountdown", () => {
  it("drops partial minutes and never shows zero", () => {
    expect(resetCountdown(NOW + 1, NOW)).toEqual({ kind: "minutes", minutes: 1 });
    expect(resetCountdown(NOW - MINUTE, NOW)).toEqual({ kind: "minutes", minutes: 1 });
    expect(resetCountdown(NOW + HOUR - 1, NOW)).toEqual({ kind: "minutes", minutes: 59 });
    expect(resetCountdown(NOW + 2 * HOUR + 10 * MINUTE + 59_000, NOW)).toEqual({
      kind: "hours",
      hours: 2,
      minutes: 10,
    });
    expect(resetCountdown(NOW + 26 * HOUR + 30 * MINUTE, NOW)).toEqual({
      kind: "days",
      days: 1,
      hours: 2,
    });
  });
});
