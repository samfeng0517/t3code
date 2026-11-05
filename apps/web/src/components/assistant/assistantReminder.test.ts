import type { AssistantClockStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { reminderDelayMs } from "./assistantReminder";

const working: AssistantClockStatus = {
  reportDate: "2026-11-05",
  serverNow: "2026-11-05T05:05:00.000Z",
  segments: [
    { start: "2026-11-05T01:02:00.000Z", end: "2026-11-05T04:01:00.000Z", hours: 179 / 60 },
    { start: "2026-11-05T05:05:00.000Z", end: null, hours: 0 },
  ],
  activeStart: "2026-11-05T05:05:00.000Z",
  completedHours: 179 / 60,
  requiredHours: 8,
  expectedEnd: "2026-11-05T10:06:00.000Z",
};

const nowMs = Date.parse("2026-11-05T09:06:00.000Z");

describe("reminderDelayMs", () => {
  it("reminderDelayMs should return the time until expectedEnd when a segment is open", () => {
    expect(reminderDelayMs(working, nowMs, new Set())).toBe(60 * 60_000);
    expect(reminderDelayMs(working, Date.parse("2026-11-05T11:00:00.000Z"), new Set())).toBe(0);
  });

  it("reminderDelayMs should return null when no segment is open", () => {
    const stopped: AssistantClockStatus = { ...working, activeStart: null, expectedEnd: null };
    expect(reminderDelayMs(stopped, nowMs, new Set())).toBeNull();
    expect(reminderDelayMs(null, nowMs, new Set())).toBeNull();
  });

  it("reminderDelayMs should return null when the reminder already fired for the workday", () => {
    expect(reminderDelayMs(working, nowMs, new Set(["2026-11-05"]))).toBeNull();
    expect(reminderDelayMs(working, nowMs, new Set(["2026-11-04"]))).toBe(60 * 60_000);
  });
});
