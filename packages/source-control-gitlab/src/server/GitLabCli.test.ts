import { assert, it, afterEach, describe, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import { DEFAULT_SERVER_SETTINGS, VcsProcessExitError } from "@t3tools/contracts";

import type * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as GitLabCli from "./GitLabCli.ts";

const mockedRun = vi.fn<SourceControlHost.SourceControlHost["Service"]["process"]["run"]>();
const layer = it.layer(
  GitLabCli.layer.pipe(Layer.provide(TestSourceControlHost.layer({ process: { run: mockedRun } }))),
);

function processOutput(stdout: string): SourceControlHost.SourceControlProcessOutput {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

afterEach(() => {
  mockedRun.mockReset();
});

layer("GitLabCli.layer", (it) => {
  it.effect("parses merge request view output", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            JSON.stringify({
              iid: 42,
              title: "Add MR thread creation",
              web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
              target_branch: "main",
              source_branch: "feature/mr-threads",
              sha: "a".repeat(40),
              state: "closed",
              closed_at: "2026-08-23T10:00:00Z",
              source_project_id: 101,
              target_project_id: 100,
              source_project: {
                path_with_namespace: "octocat/t3code",
              },
            }),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add MR thread creation",
        url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
        baseRefName: "main",
        headRefName: "feature/mr-threads",
        headSha: "a".repeat(40),
        state: "closed",
        closedAt: "2026-08-23T10:00:00Z",
        mergedAt: null,
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/t3code",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["mr", "view", "--output", "json", "--", "42"],
        }),
      );
    }),
  );

  it.effect("skips invalid entries when parsing MR lists", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            JSON.stringify([
              {
                iid: 0,
                title: "invalid",
                web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/0",
                target_branch: "main",
                source_branch: "feature/invalid",
              },
              {
                iid: 43,
                title: "  Valid MR  ",
                web_url: " https://gitlab.com/pingdotgg/t3code/-/merge_requests/43 ",
                target_branch: " main ",
                source_branch: " feature/mr-list ",
                state: "merged",
                merged_at: "2026-08-23T11:00:00Z",
              },
            ]),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.listMergeRequests({
          cwd: "/repo",
          headSelector: "feature/mr-list",
          state: "all",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid MR",
          url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/43",
          baseRefName: "main",
          headRefName: "feature/mr-list",
          state: "merged",
          closedAt: null,
          mergedAt: "2026-08-23T11:00:00Z",
        },
      ]);
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "mr",
            "list",
            "--source-branch",
            "feature/mr-list",
            "--all",
            "--per-page",
            "20",
            "--output",
            "json",
          ],
        }),
      );
    }),
  );

  it.effect("surfaces a friendly error when the merge request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 merge request not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Merge request 4888 was not found"), true);
      assert.strictEqual(error._tag, "GitLabMergeRequestNotFoundError");
      assert.strictEqual(error.command, "glab");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }),
  );

  it.effect("keeps non-merge-request not-found failures generic", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 project not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "missing/project",
        });
      }).pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitLabCliCommandError");
      assert.strictEqual(error.cause, cause);
    }),
  );

  it.effect("preserves rate-limit failures as a distinct error", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "API rate limit exceeded.",
        failureKind: "rate-limited",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const glab = yield* GitLabCli.GitLabCli;
      const error = yield* glab
        .execute({ cwd: "/repo", args: ["api", "projects"] })
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitLabCliRateLimitError");
      assert.strictEqual(error.cause, cause);
    }),
  );
});

const savedRun = vi.fn<SourceControlHost.SourceControlHost["Service"]["process"]["run"]>();
const savedSettingsLayer = it.layer(
  GitLabCli.layer.pipe(
    Layer.provide(
      TestSourceControlHost.layer({
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlHosts: {
            gitlab: { host: "https://GitLab.Example.com/", token: "glpat-saved" },
          },
        },
        process: { run: savedRun },
      }),
    ),
  ),
);

afterEach(() => {
  savedRun.mockReset();
});

savedSettingsLayer("GitLabCli.layer with a server and token saved in Settings", (it) => {
  it.effect("hands glab the saved token, and names the server, for that server alone", () =>
    Effect.gen(function* () {
      savedRun.mockReturnValue(Effect.succeed(processOutput("{}")));
      const glab = yield* GitLabCli.GitLabCli;

      yield* glab.execute({
        cwd: "/repo",
        host: "gitlab.example.com",
        args: ["api", "projects/sam%2Ft3code"],
      });
      yield* glab.execute({ cwd: "/repo", host: "gitlab.com", args: ["api", "user"] });
      yield* glab.execute({ cwd: "/repo", args: ["api", "user"] });

      const [selfHosted, gitlabCom, unnamed] = savedRun.mock.calls.map(([input]) => input);
      expect(selfHosted).toMatchObject({
        command: "glab",
        args: ["api", "--hostname", "gitlab.example.com", "projects/sam%2Ft3code"],
        env: { GITLAB_TOKEN: "glpat-saved", GITLAB_HOST: "https://gitlab.example.com" },
      });
      for (const call of [gitlabCom, unnamed]) {
        expect(call?.args).toEqual(["api", "user"]);
      }
      expect(gitlabCom?.env).toEqual({ GITLAB_HOST: "gitlab.com" });
      expect(unnamed?.env).toBeUndefined();
    }),
  );

  it.effect("signs in a merge request command for the saved server without rewriting it", () =>
    Effect.gen(function* () {
      savedRun.mockReturnValue(Effect.succeed(processOutput("[]")));
      const glab = yield* GitLabCli.GitLabCli;

      yield* glab.listMergeRequests({
        cwd: "/repo",
        host: "gitlab.example.com",
        headSelector: "feature/self-hosted",
        state: "open",
      });

      expect(savedRun.mock.calls[0]?.[0]).toMatchObject({
        args: [
          "mr",
          "list",
          "--source-branch",
          "feature/self-hosted",
          "--per-page",
          "20",
          "--output",
          "json",
        ],
        env: { GITLAB_TOKEN: "glpat-saved", GITLAB_HOST: "https://gitlab.example.com" },
      });
    }),
  );
});

const portedRun = vi.fn<SourceControlHost.SourceControlHost["Service"]["process"]["run"]>();
const portedSettingsLayer = it.layer(
  GitLabCli.layer.pipe(
    Layer.provide(
      TestSourceControlHost.layer({
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlHosts: {
            gitlab: { host: "gitlab.example.com:8443", token: "glpat-saved" },
          },
        },
        process: { run: portedRun },
      }),
    ),
  ),
);

afterEach(() => {
  portedRun.mockReset();
});

portedSettingsLayer("GitLabCli.layer with a server saved on its own port", (it) => {
  it.effect("moves a merge request command's repository onto the saved port", () =>
    Effect.gen(function* () {
      portedRun.mockReturnValue(Effect.succeed(processOutput("")));
      const glab = yield* GitLabCli.GitLabCli;

      yield* glab.execute({
        cwd: "/repo",
        host: "gitlab.example.com",
        args: ["mr", "merge", "7", "--repo", "https://gitlab.example.com/group/proj", "--yes"],
      });
      yield* glab.execute({
        cwd: "/repo",
        host: "gitlab.com",
        args: ["mr", "close", "7", "--repo", "https://gitlab.com/group/proj"],
      });

      const [ported, elsewhere] = portedRun.mock.calls.map(([input]) => input.args);
      expect(ported).toEqual([
        "mr",
        "merge",
        "7",
        "--repo",
        "https://gitlab.example.com:8443/group/proj",
        "--yes",
      ]);
      expect(elsewhere).toEqual(["mr", "close", "7", "--repo", "https://gitlab.com/group/proj"]);
    }),
  );
});

describe("gitLabSavedCredential", () => {
  it("matches the saved server by name and keeps the port it was saved with", () => {
    expect(
      GitLabCli.gitLabSavedCredential(
        { host: "gitlab.example.com:8443", token: "glpat-saved" },
        "GITLAB.EXAMPLE.COM",
      ),
    ).toEqual({ authority: "gitlab.example.com:8443", token: "glpat-saved" });
  });

  it("reads an empty server as gitlab.com", () => {
    expect(GitLabCli.gitLabSavedCredential({ token: "glpat-saved" }, "gitlab.com")).toEqual({
      authority: "gitlab.com",
      token: "glpat-saved",
    });
  });

  it("has nothing for another server, an unnamed one, or a server saved without a token", () => {
    const saved = { host: "gitlab.example.com", token: "glpat-saved" };
    expect(GitLabCli.gitLabSavedCredential(saved, "gitlab.com")).toBeNull();
    expect(GitLabCli.gitLabSavedCredential(saved, undefined)).toBeNull();
    expect(
      GitLabCli.gitLabSavedCredential({ host: "gitlab.example.com" }, "gitlab.example.com"),
    ).toBeNull();
  });
});
