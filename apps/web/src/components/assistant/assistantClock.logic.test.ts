import type {
  AssistantClockStatus,
  AssistantDailyReportStatus,
  AssistantDraft,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  dailyChip,
  draftRejectionMessageKey,
  formatDuration,
  msUntilNextMinute,
  remainingHours,
  sidebarTimer,
  workedHours,
} from "./assistantClock.logic";

const clock = (overrides: Partial<AssistantClockStatus> = {}): AssistantClockStatus => ({
  reportDate: "2026-11-05",
  serverNow: "2026-11-05T05:00:00.000Z",
  segments: [{ start: "2026-11-05T01:02:00.000Z", end: "2026-11-05T04:01:00.000Z", hours: 2.98 }],
  activeStart: null,
  completedHours: 2.98,
  requiredHours: 8,
  expectedEnd: null,
  ...overrides,
});

const report = (
  overrides: Partial<AssistantDailyReportStatus> = {},
): AssistantDailyReportStatus => ({
  reportDate: "2026-11-05",
  exempt: false,
  submittedAt: null,
  erpDailyReportUrl: "https://erp.example.com/daily-reports",
  ...overrides,
});

const draft = (overrides: Partial<AssistantDraft> = {}): AssistantDraft => ({
  reportDate: "2026-11-05",
  status: "ready",
  items: [],
  problemText: "",
  revision: 1,
  version: 1,
  sources: [],
  editedByUser: false,
  triggerAttempt: 0,
  updatedAt: "2026-11-05T02:00:00.000Z",
  ...overrides,
});

describe("formatDuration", () => {
  it("formatDuration should render 5:12 when hours is 5.2", () => {
    expect(formatDuration(5.2)).toBe("5:12");
  });

  it("formatDuration should floor to the minute when hours carry a float error", () => {
    expect(formatDuration(179 / 60)).toBe("2:59");
    expect(formatDuration(8)).toBe("8:00");
    expect(formatDuration(-1)).toBe("0:00");
  });
});

describe("workedHours", () => {
  it("workedHours should add the open segment's elapsed time when a segment is open", () => {
    const status = clock({ activeStart: "2026-11-05T05:05:00.000Z" });
    expect(workedHours(status, Date.parse("2026-11-05T07:05:00.000Z"))).toBeCloseTo(4.98);
  });
});

describe("remainingHours", () => {
  it("remainingHours should return 0 when worked hours exceed required hours", () => {
    expect(remainingHours(clock({ completedHours: 9 }), 0)).toBe(0);
  });

  it("remainingHours should return the hours still owed when no segment is open", () => {
    expect(remainingHours(clock(), 0)).toBeCloseTo(5.02);
  });
});

describe("dailyChip", () => {
  it("dailyChip should return exempt when the report is exempt even if a draft exists", () => {
    expect(dailyChip({ clock: clock(), report: report({ exempt: true }), draft: draft() })).toEqual(
      { kind: "exempt" },
    );
  });

  it("dailyChip should return idle when there are no segments today", () => {
    expect(dailyChip({ clock: clock({ segments: [] }), report: report(), draft: draft() })).toEqual(
      { kind: "idle" },
    );
  });

  it("dailyChip should return submitted with the time when ERP reports submittedAt", () => {
    expect(
      dailyChip({
        clock: clock(),
        report: report({ submittedAt: "2026-11-05T02:34:00.000Z" }),
        draft: draft(),
      }),
    ).toEqual({ kind: "submitted", submittedAt: "2026-11-05T02:34:00.000Z" });
  });

  it("dailyChip should return the draft's status when today has segments and a draft", () => {
    expect(
      dailyChip({ clock: clock(), report: report(), draft: draft({ status: "failed" }) }),
    ).toEqual({ kind: "failed" });
  });
});

describe("sidebarTimer", () => {
  it("sidebarTimer should return null when there are no segments today", () => {
    expect(sidebarTimer(clock({ segments: [] }), 0)).toBeNull();
  });

  it("sidebarTimer should return working with the worked hours when a segment is open", () => {
    const status = clock({ activeStart: "2026-11-05T05:05:00.000Z" });
    expect(sidebarTimer(status, Date.parse("2026-11-05T05:05:00.000Z"))).toEqual({
      kind: "working",
      hours: 2.98,
    });
  });
});

describe("msUntilNextMinute", () => {
  it("msUntilNextMinute should return the time left to the next minute boundary when called mid-minute or on a boundary", () => {
    expect(msUntilNextMinute(Date.parse("2026-11-05T05:05:20.000Z"))).toBe(40_000);
    expect(msUntilNextMinute(Date.parse("2026-11-05T05:05:00.000Z"))).toBe(60_000);
  });
});

describe("draftRejectionMessageKey", () => {
  it.each([
    ["busy", "assistantPage.draftRejected.busy"],
    ["stale-revision", "assistantPage.draftRejected.staleRevision"],
    ["submitted", "assistantPage.draftRejected.submitted"],
    ["not-editable", "assistantPage.draftRejected.notEditable"],
    ["no-draft", "assistantPage.draftRejected.noDraft"],
    ["thread-unavailable", "assistantPage.draftRejected.threadUnavailable"],
  ] as const)(
    "draftRejectionMessageKey should return the draft rejection copy when the reason is %s",
    (reason, key) => {
      expect(draftRejectionMessageKey(reason)).toBe(key);
    },
  );
  it.each(["unavailable", "unauthorized", "rejected"] as const)(
    "draftRejectionMessageKey should return null when the reason is the ERP error %s",
    (reason) => {
      expect(draftRejectionMessageKey(reason)).toBeNull();
    },
  );
});
