import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activeRootThreads,
  projectInRepoChecker,
  threadsUsingBranch,
  worktreeHoldingThread,
} from "./gitActionGuards";

const environmentId = EnvironmentId.make("env-1");
const repoProject = ProjectId.make("project-repo");
const otherProject = ProjectId.make("project-other");
const roots: Record<string, string> = {
  [repoProject]: "/work/repo/",
  [otherProject]: "/work/other",
};
const projectRootOf = (projectId: ProjectId) => roots[projectId] ?? null;
const inRepo = (repoRoot: string) =>
  projectInRepoChecker({ projectRootOf, repoRoot, showToplevel: async () => repoRoot });

function thread(overrides: {
  readonly id: string;
  readonly projectId?: ProjectId;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly running?: boolean;
  readonly rootId?: string;
  readonly settled?: boolean;
}): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(overrides.id),
    projectId: overrides.projectId ?? repoProject,
    title: overrides.id,
    branch: overrides.branch ?? null,
    worktreePath: overrides.worktreePath ?? null,
    lineage: { rootThreadId: ThreadId.make(overrides.rootId ?? overrides.id) },
    settledOverride: overrides.settled ? "settled" : null,
    runtime: overrides.running
      ? {
          status: "running",
          activeRunId: null,
          providerInstanceId: "codex",
          providerName: null,
          lastError: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        }
      : null,
  } as unknown as EnvironmentThreadShell;
}

describe("threadsUsingBranch", () => {
  it("threadsUsingBranch should match a worktree thread on the branch when its worktree belongs to the repo", async () => {
    const worktreeThread = thread({
      id: "wt",
      branch: "fix/login",
      worktreePath: "/work/repo-worktrees/fix-login/",
    });
    const result = await threadsUsingBranch({
      threads: [worktreeThread, thread({ id: "other-branch", branch: "main" })],
      projectInRepo: inRepo("/work/repo"),
      environmentId,
      repoRoot: "/work/repo",
      worktreePaths: ["/work/repo-worktrees/fix-login"],
      branch: "fix/login",
    });
    expect(result.map((entry) => entry.title)).toEqual(["wt"]);
  });

  it("threadsUsingBranch should ignore a thread on the same branch name when it belongs to another repository", async () => {
    const result = await threadsUsingBranch({
      threads: [
        thread({ id: "other-root", projectId: otherProject, branch: "main" }),
        thread({
          id: "other-worktree",
          projectId: otherProject,
          branch: "main",
          worktreePath: "/work/other-wt",
        }),
        thread({
          id: "other-env",
          branch: "main",
          projectId: repoProject,
        }),
      ].map((entry) =>
        entry.title === "other-env"
          ? { ...entry, environmentId: EnvironmentId.make("env-2") }
          : entry,
      ),
      projectInRepo: inRepo("/work/repo"),
      environmentId,
      repoRoot: "/work/repo",
      worktreePaths: [],
      branch: "main",
    });
    expect(result).toEqual([]);
  });

  it("threadsUsingBranch should match a local thread when its project sits inside the repo", async () => {
    const result = await threadsUsingBranch({
      threads: [thread({ id: "local", branch: "main" })],
      projectInRepo: inRepo("/work"),
      environmentId,
      repoRoot: "/work",
      worktreePaths: [],
      branch: "main",
    });
    expect(result.map((entry) => entry.title)).toEqual(["local"]);
  });

  it("threadsUsingBranch should ignore a local thread when its project is a sibling directory sharing the repo root as a prefix", async () => {
    const result = await threadsUsingBranch({
      threads: [thread({ id: "sibling", projectId: otherProject, branch: "main" })],
      projectInRepo: projectInRepoChecker({
        projectRootOf: () => "/work/repo-other",
        repoRoot: "/work/repo",
        showToplevel: async () => "/work/repo",
      }),
      environmentId,
      repoRoot: "/work/repo",
      worktreePaths: [],
      branch: "main",
    });
    expect(result).toEqual([]);
  });

  it("threadsUsingBranch should match a worktree thread when its worktree was removed but its project belongs to the repo", async () => {
    const result = await threadsUsingBranch({
      threads: [thread({ id: "gone", branch: "fix/login", worktreePath: "/work/removed-wt" })],
      projectInRepo: inRepo("/work/repo"),
      environmentId,
      repoRoot: "/work/repo",
      worktreePaths: [],
      branch: "fix/login",
    });
    expect(result.map((entry) => entry.title)).toEqual(["gone"]);
  });

  it("threadsUsingBranch should ignore a local thread when its project is a separate repository nested inside the repo", async () => {
    const result = await threadsUsingBranch({
      threads: [thread({ id: "nested", branch: "main" })],
      projectInRepo: projectInRepoChecker({
        projectRootOf: () => "/repo/vendor/lib",
        repoRoot: "/repo",
        showToplevel: async () => "/repo/vendor/lib",
      }),
      environmentId,
      repoRoot: "/repo",
      worktreePaths: [],
      branch: "main",
    });
    expect(result).toEqual([]);
  });

  it("threadsUsingBranch should match a local thread when its project is a linked worktree nested inside the repo", async () => {
    const worktree = "/repo/.claude/worktrees/feature";
    const result = await threadsUsingBranch({
      threads: [thread({ id: "nested-worktree", branch: "feature" })],
      projectInRepo: projectInRepoChecker({
        projectRootOf: () => worktree,
        repoRoot: "/repo",
        // A linked worktree is its own toplevel, though it shares the repository.
        showToplevel: async () => worktree,
        worktreePaths: [worktree],
      }),
      environmentId,
      repoRoot: "/repo",
      worktreePaths: [worktree],
      branch: "feature",
    });
    expect(result.map((entry) => entry.title)).toEqual(["nested-worktree"]);
  });
});

describe("activeRootThreads", () => {
  it("activeRootThreads should ignore an active thread when it runs in a worktree", async () => {
    const result = await activeRootThreads({
      threads: [
        thread({ id: "worktree", worktreePath: "/work/repo-wt", running: true }),
        thread({ id: "root", running: true }),
        thread({ id: "idle" }),
        thread({ id: "sibling", projectId: otherProject, running: true }),
      ],
      projectInRepo: inRepo("/work/repo"),
      environmentId,
      repoRoot: "/work/repo",
    });
    expect(result.map((entry) => entry.title)).toEqual(["root"]);
  });

  it("activeRootThreads should ignore an active local thread when its project is a separate repository nested inside the repo", async () => {
    const result = await activeRootThreads({
      threads: [thread({ id: "nested", running: true })],
      projectInRepo: projectInRepoChecker({
        projectRootOf: () => "/repo/vendor/lib",
        repoRoot: "/repo",
        showToplevel: async () => "/repo/vendor/lib",
      }),
      environmentId,
      repoRoot: "/repo",
    });
    expect(result).toEqual([]);
  });
});

describe("projectInRepoChecker", () => {
  it("projectInRepoChecker should skip the lookup when the project sits at the repo root or outside it", async () => {
    const lookups: string[] = [];
    const check = projectInRepoChecker({
      projectRootOf,
      repoRoot: "/work/repo",
      showToplevel: async (cwd) => {
        lookups.push(cwd);
        return cwd;
      },
    });
    expect(await check(repoProject)).toBe(true);
    expect(await check(otherProject)).toBe(false);
    expect(lookups).toEqual([]);
  });

  it("projectInRepoChecker should look up a nested project once when several threads share it", async () => {
    const lookups: string[] = [];
    const check = projectInRepoChecker({
      projectRootOf: () => "/work/repo/packages/app",
      repoRoot: "/work/repo",
      showToplevel: async (cwd) => {
        lookups.push(cwd);
        return "/work/repo/";
      },
    });
    expect(await check(repoProject)).toBe(true);
    expect(await check(repoProject)).toBe(true);
    expect(lookups).toEqual(["/work/repo/packages/app"]);
  });

  it("projectInRepoChecker should treat a nested project as in the repo when its lookup fails", async () => {
    const check = projectInRepoChecker({
      projectRootOf: () => "/work/repo/packages/app",
      repoRoot: "/work/repo",
      showToplevel: async () => null,
    });
    expect(await check(repoProject)).toBe(true);
  });
});

describe("worktreeHoldingThread", () => {
  const holder = (
    threadIds: ReadonlyArray<string>,
    shells: ReadonlyArray<EnvironmentThreadShell>,
    families: Record<string, ReadonlyArray<EnvironmentThreadShell> | null> = {},
  ) =>
    worktreeHoldingThread({
      threadIds: threadIds.map((id) => ThreadId.make(id)),
      shellOf: (threadId) => shells.find((shell) => shell.id === threadId) ?? null,
      familyOf: async (threadId) => families[threadId] ?? null,
    });

  it("worktreeHoldingThread should return null when every thread on the worktree is settled or gone", async () => {
    const result = await holder(
      ["settled", "older-settled", "gone"],
      [thread({ id: "settled", settled: true })],
      {
        "older-settled": [thread({ id: "older-settled", settled: true })],
        gone: [],
      },
    );
    expect(result).toBeNull();
  });

  it("worktreeHoldingThread should return the thread when it is unsettled or still running", async () => {
    expect(await holder(["open"], [thread({ id: "open" })])).toMatchObject({ title: "open" });
    expect(
      await holder(["busy"], [thread({ id: "busy", settled: true, running: true })]),
    ).toMatchObject({ title: "busy" });
  });

  it("worktreeHoldingThread should follow a subagent child to its root when deciding whether it is settled", async () => {
    const child = thread({ id: "child", rootId: "root" });
    expect(await holder(["child"], [], { child: [child] })).toBeNull();
    expect(await holder(["child"], [thread({ id: "root" })], { child: [child] })).toMatchObject({
      title: "child",
    });
    expect(
      await holder(["child"], [], { child: [child, thread({ id: "root", settled: true })] }),
    ).toBeNull();
  });

  it("worktreeHoldingThread should return unknown when an omitted thread's family read fails", async () => {
    expect(await holder(["omitted"], [], { omitted: null })).toBe("unknown");
  });
});
