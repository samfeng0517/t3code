import { ThreadId, type WorktreeSetupSnapshot, type WorktreeSetupStage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveVisibleWorktreeSetup } from "./worktreeSetup.ts";

const stage = (
  id: WorktreeSetupStage["id"],
  status: WorktreeSetupStage["status"],
  detail: string | null = null,
): WorktreeSetupStage => ({
  id,
  status,
  startedAt: null,
  endedAt: null,
  percent: null,
  detail,
  tail: [],
});

const finished = (stages: ReadonlyArray<WorktreeSetupStage>): WorktreeSetupSnapshot => ({
  threadId: ThreadId.make("setup-thread"),
  sequence: 2,
  phase: "done",
  startedAt: "2026-09-17T00:00:00.000Z",
  endedAt: "2026-09-17T00:00:05.000Z",
  branch: "feature",
  baseRef: "main",
  worktreePath: null,
  setupScript: null,
  stages,
  error: null,
});

const warned = finished([
  stage("fetch", "warning", "Couldn't reach origin; started from the local main"),
  stage("checkout", "done"),
  stage("agent", "done"),
]);

describe("resolveVisibleWorktreeSetup", () => {
  it("resolveVisibleWorktreeSetup should keep a finished snapshot when a stage warned after the turn started", () => {
    expect(
      resolveVisibleWorktreeSetup({
        live: warned,
        recorded: null,
        turnStarted: true,
        followUpSent: false,
      }),
    ).toBe(warned);
  });

  it("resolveVisibleWorktreeSetup should hide a finished snapshot with a warning when a follow-up was sent", () => {
    expect(
      resolveVisibleWorktreeSetup({
        live: warned,
        recorded: null,
        turnStarted: true,
        followUpSent: true,
      }),
    ).toBeNull();
  });

  it("resolveVisibleWorktreeSetup should hide a clean finished snapshot when the turn started", () => {
    const clean = finished([stage("fetch", "done"), stage("checkout", "done")]);
    expect(
      resolveVisibleWorktreeSetup({
        live: clean,
        recorded: null,
        turnStarted: true,
        followUpSent: false,
      }),
    ).toBeNull();
  });
});
