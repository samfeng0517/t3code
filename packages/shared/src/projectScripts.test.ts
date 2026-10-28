import { describe, expect, it } from "@effect/vitest";

import { projectScriptRuntimeEnv } from "./projectScripts.ts";

describe("projectScriptRuntimeEnv", () => {
  it("sets the Superset and Orca variables so imported scripts run unchanged", () => {
    expect(
      projectScriptRuntimeEnv({
        project: { cwd: "/repo" },
        worktreePath: "/home/me/.t3/worktrees/repo/feature-x/",
      }),
    ).toEqual({
      SUPERSET_ROOT_PATH: "/repo",
      SUPERSET_WORKSPACE_PATH: "/home/me/.t3/worktrees/repo/feature-x/",
      SUPERSET_WORKSPACE_NAME: "feature-x",
      ORCA_ROOT_PATH: "/repo",
      ORCA_WORKTREE_PATH: "/home/me/.t3/worktrees/repo/feature-x/",
      ORCA_WORKSPACE_NAME: "feature-x",
      CONDUCTOR_ROOT_PATH: "/repo",
      GHOSTX_ROOT_PATH: "/repo",
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/home/me/.t3/worktrees/repo/feature-x/",
    });
  });

  it("treats the main checkout as the workspace when there is no worktree", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "C:\\code\\repo" },
      extraEnv: { PORT: "4000" },
    });
    expect(env.ORCA_WORKTREE_PATH).toBe("C:\\code\\repo");
    expect(env.SUPERSET_WORKSPACE_NAME).toBe("repo");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
    expect(env.PORT).toBe("4000");
  });
});
