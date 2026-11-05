import { EnvironmentId, type AssistantClockStatus } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { reminderDelayMs, trackAssistantClock } from "./assistantReminder";

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
const stopped: AssistantClockStatus = { ...working, activeStart: null, expectedEnd: null };

const nowMs = Date.parse("2026-11-05T09:06:00.000Z");
const HOUR_MS = 60 * 60_000;

describe("reminderDelayMs", () => {
  it("reminderDelayMs should return the time until expectedEnd when a segment is open", () => {
    expect(reminderDelayMs(working, nowMs, new Set())).toBe(60 * 60_000);
    expect(reminderDelayMs(working, Date.parse("2026-11-05T11:00:00.000Z"), new Set())).toBe(0);
  });

  it("reminderDelayMs should return null when no segment is open", () => {
    expect(reminderDelayMs(stopped, nowMs, new Set())).toBeNull();
    expect(reminderDelayMs(null, nowMs, new Set())).toBeNull();
  });

  it("reminderDelayMs should return null when the reminder already fired for the workday", () => {
    expect(reminderDelayMs(working, nowMs, new Set(["2026-11-05"]))).toBeNull();
    expect(reminderDelayMs(working, nowMs, new Set(["2026-11-04"]))).toBe(60 * 60_000);
  });
});

type ClockResult = AsyncResult.AsyncResult<AssistantClockStatus, string>;

/** `erp` is what a fetch returns; `push` delivers a value the way a clock-in/out refetch does. */
function makeHarness(initial: AssistantClockStatus) {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  const registry = AtomRegistry.make();
  const environmentId = Atom.make<EnvironmentId | null>(EnvironmentId.make("environment-primary"));
  const erp: { result: ClockResult; reads: number } = {
    result: AsyncResult.success(initial),
    reads: 0,
  };
  const pushes = Atom.make(0);
  const clockStatus = Atom.make((get): ClockResult => {
    get(pushes);
    erp.reads += 1;
    return erp.result;
  });
  const remind = vi.fn<() => void>();
  trackAssistantClock({ registry, environmentId, clockStatus: () => clockStatus, remind });
  const push = (status: AssistantClockStatus) => {
    erp.result = AsyncResult.success(status);
    registry.update(pushes, (count) => count + 1);
  };
  return { registry, erp, push, remind };
}

describe("trackAssistantClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trackAssistantClock should remind once per workday when the required hours are done", () => {
    const { registry, push, remind } = makeHarness(working);
    vi.advanceTimersByTime(HOUR_MS);
    expect(remind).toHaveBeenCalledTimes(1);

    push({ ...working });
    vi.advanceTimersByTime(HOUR_MS);
    expect(remind).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("trackAssistantClock should not remind when the user clocks out before expectedEnd", () => {
    const { registry, push, remind } = makeHarness(working);
    vi.advanceTimersByTime(HOUR_MS / 2);
    push(stopped);
    vi.advanceTimersByTime(2 * HOUR_MS);
    expect(remind).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("trackAssistantClock should not remind when the refresh at expectedEnd shows a clock-out", () => {
    const { registry, erp, push, remind } = makeHarness(working);
    erp.result = AsyncResult.success(working, { waiting: true });
    const readsBefore = erp.reads;
    vi.advanceTimersByTime(HOUR_MS);
    expect(erp.reads).toBe(readsBefore + 1);
    expect(remind).not.toHaveBeenCalled();

    push(stopped);
    vi.advanceTimersByTime(2 * HOUR_MS);
    expect(erp.reads).toBe(readsBefore + 2);
    expect(remind).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("trackAssistantClock should reschedule when the refresh at expectedEnd moves expectedEnd later", () => {
    const { registry, erp, remind } = makeHarness(working);
    erp.result = AsyncResult.success({ ...working, expectedEnd: "2026-11-05T10:36:00.000Z" });
    vi.advanceTimersByTime(HOUR_MS);
    expect(remind).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR_MS / 2);
    expect(remind).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("trackAssistantClock should remind from the last status when the refresh at expectedEnd fails", () => {
    const { registry, erp, remind } = makeHarness(working);
    erp.result = AsyncResult.fail("erp-unreachable");
    const readsBefore = erp.reads;
    vi.advanceTimersByTime(HOUR_MS);
    expect(erp.reads).toBe(readsBefore + 1);
    expect(remind).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});
