import { DEFAULT_SERVER_SETTINGS, SourceControlProviderKind } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { refineUnknownRemoteProvider } from "@t3tools/source-control-core/server/discovery";
import { processOutput } from "@t3tools/source-control-testing/TestSourceControlHost";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/process";

import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as GitLabCli from "./GitLabCli.ts";
import { parseGitLabAuthStatusHosts } from "./gitLabAuthStatus.ts";
import * as GitLabSourceControlProvider from "./GitLabSourceControlProvider.ts";
import { definition } from "../shared/definition.ts";

function makeProvider(gitlab: Partial<GitLabCli.GitLabCli["Service"]>) {
  return GitLabSourceControlProvider.make.pipe(
    Effect.provide(
      Layer.mergeAll(Layer.mock(GitLabCli.GitLabCli)(gitlab), TestSourceControlHost.layer()),
    ),
  );
}

it("accepts authenticated GitLab hosts when another configured host fails", () => {
  const auth = GitLabSourceControlProvider.discovery.parseAuth({
    exitCode: ChildProcessSpawner.ExitCode(1),
    stdout: `gitlab.com
  x gitlab.com: API call failed: 401 Unauthorized
  ! No token found
self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
  ✓ Token found: ******
`,
    stderr: "",
  });

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("gitlab-user"),
      host: Option.some("self-hosted.example.test"),
    },
  );
});

it("refines unknown GitLab remotes with mixed-case provider hosts", () => {
  const provider = GitLabSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: SourceControlProviderKind.make("unknown"),
        name: "Self-Hosted.Example.Test",
        baseUrl: "https://Self-Hosted.Example.Test",
      },
      remoteName: "origin",
      remoteUrl: "https://Self-Hosted.Example.Test/group/project.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: `self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
  ✓ Token found: ******
`,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitlab",
    name: "GitLab Self-Hosted",
    baseUrl: "https://Self-Hosted.Example.Test",
  });
});

it("tells a host glab has no login for apart from output that cannot say", () => {
  const refine = (stderr: string) =>
    GitLabSourceControlProvider.discovery.refineUnknownRemote?.({
      cwd: "/repo",
      context: {
        provider: {
          kind: SourceControlProviderKind.make("unknown"),
          name: "git.example.test",
          baseUrl: "https://git.example.test",
        },
        remoteName: "origin",
        remoteUrl: "https://git.example.test/group/project.git",
      },
      auth: { exitCode: ChildProcessSpawner.ExitCode(1), stdout: "", stderr },
    });

  assert.strictEqual(
    refine("x git.example.test has not been authenticated with glab. Run `glab auth login`"),
    null,
  );
  assert.strictEqual(
    refine("No GitLab instances have been authenticated with glab. Run `glab auth login`"),
    null,
  );
  assert.strictEqual(refine("git.example.test\n  x API call failed: 503"), undefined);
});

// regression: #15395 self-hosted GitLab remotes resolve bare MR numbers once glab is signed in
it.effect.each([
  [
    "https://code.example.test:8443@Code.Example.Test:8443/Team/Repo.git",
    true,
    "gitlab",
    "Code.Example.Test:8443",
  ],
  ["git@code.example.test:team/repo.git", true, "gitlab"],
  ["https://code.example.test/team/repo.git", false, "unknown"],
  ["https://github.com/team/repo.git", true, "github"],
] as const)(
  "resolves MR numbers for %s with authenticated=%s as %s",
  ([remoteUrl, authenticated, expectedProvider, expectedAuthHost = "code.example.test"]) =>
    Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const identity = {
        canonicalKey: normalizeGitRemoteUrl(remoteUrl),
        locator: { source: "git-remote" as const, remoteName: "upstream", remoteUrl },
        rootPath: "/repo",
        // Only a remote no host recognised is left for glab to refine.
        provider: SourceControlProviderKind.make(
          expectedProvider === "github" ? "github" : "unknown",
        ),
      };
      let authCalls = 0;
      const refined = yield* (
        provider.refineRepositoryIdentity?.({
          identity,
          resolveContext: (input) =>
            refineUnknownRemoteProvider({
              ...input,
              specs: [GitLabSourceControlProvider.discovery],
              process: {
                run: ({ command, args, cwd }) => {
                  authCalls++;
                  assert.deepStrictEqual(
                    { command, args, cwd },
                    {
                      command: "glab",
                      args: ["auth", "status", "--hostname", expectedAuthHost],
                      cwd: "/repo",
                    },
                  );
                  return Effect.succeed(
                    processOutput(
                      authenticated
                        ? `${expectedAuthHost}\n  ✓ Logged in to ${expectedAuthHost} as gitlab-user\n`
                        : "x code.example.test has not been authenticated with glab.",
                      { exitCode: ChildProcessSpawner.ExitCode(authenticated ? 0 : 1) },
                    ),
                  );
                },
              },
            }).pipe(
              Effect.map(({ provider }) =>
                provider ? { ...input.context, provider } : input.context,
              ),
            ),
        }) ?? Effect.succeed(identity)
      );
      if (expectedProvider === "gitlab") {
        const [host, ...repository] = refined.canonicalKey.split("/");
        assert.strictEqual(
          definition.changeRequestUrl({
            host: host!,
            repository: repository.join("/"),
            number: 42,
          }),
          "https://code.example.test/team/repo/-/merge_requests/42",
        );
      }
      assert.deepStrictEqual(refined, {
        ...identity,
        provider: SourceControlProviderKind.make(expectedProvider),
      });
      if (expectedProvider === "github") assert.strictEqual(authCalls, 0);
    }),
);

it("parses authenticated GitLab auth status hosts with ports and single-label names", () => {
  assert.deepStrictEqual(
    parseGitLabAuthStatusHosts(`localhost:8080
  ✓ Logged in to localhost:8080 as local-user
selfhosted
  ✓ Logged in to selfhosted as single-label-user
`),
    [
      { host: "localhost:8080", account: "local-user" },
      { host: "selfhosted", account: "single-label-user" },
    ],
  );
});

it.effect.each(["merge_requests", "issues"])(
  "resolves %s subjects on the linked host without using the checkout",
  (kind) =>
    Effect.gen(function* () {
      const provider = yield* makeProvider({
        execute: (input) => {
          assert.deepStrictEqual(input.args, [
            "api",
            "--hostname",
            "gitlab.com",
            `projects/group%2Fsubgroup%2Fproject/${kind}/42`,
          ]);
          assert.strictEqual(input.maxOutputBytes, 32_000);
          assert.strictEqual(input.timeoutMs, 3_000);
          return Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdout: JSON.stringify({
              title: "Pairing expiry",
              description: "Preserve remote access",
            }),
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        },
      });
      const lookup = provider.resolveLink?.({
        cwd: "/unrelated",
        url: new URL(`https://gitlab.com/group/subgroup/project/-/${kind}/42`),
      });
      assert.ok(lookup);
      assert.deepStrictEqual(yield* lookup, {
        title: "Pairing expiry",
        body: "Preserve remote access",
      });
      for (const url of [
        "https://gitlab.com/owner/repo",
        "https://gitlab.attacker.test/team/project/-/issues/1",
      ]) {
        assert.strictEqual(
          provider.resolveLink?.({ cwd: "/unrelated", url: new URL(url) }),
          undefined,
        );
      }
    }),
);

it.effect.each(["read", "decode"] as const)(
  "retains the %s failure without exposing its raw contents",
  (stage) =>
    Effect.gen(function* () {
      const cause = new GitLabCli.GitLabCliCommandError({
        command: "glab",
        cwd: "/repo",
        operation: "execute",
        cause: new Error("private response text"),
      });
      const provider = yield* makeProvider({
        execute: () =>
          stage === "read"
            ? Effect.fail(cause)
            : Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "private response text",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
      });
      const lookup = provider.resolveLink?.({
        cwd: "/repo",
        url: new URL("https://gitlab.com/owner/repo/-/issues/42"),
      });
      assert.ok(lookup);
      const error = yield* Effect.flip(lookup);
      assert.strictEqual(error.operation, stage === "read" ? "resolveLink" : "resolveLink.decode");
      assert.strictEqual(error.detail, "The linked subject could not be read.");
      assert.notInclude(error.message, "private response text");
      if (stage === "read") assert.strictEqual(error.cause, cause);
      else assert.propertyVal(error.cause, "_tag", "SchemaError");
    }),
);

const selfHostedSettings = (saved: Record<string, string>) => ({
  ...DEFAULT_SERVER_SETTINGS,
  sourceControlHosts: { gitlab: saved },
});

it.effect("claims a remote on the server saved in Settings without asking glab", () =>
  Effect.gen(function* () {
    const discovery = yield* GitLabSourceControlProvider.makeDiscovery.pipe(
      Effect.provide(
        TestSourceControlHost.layer({ settings: selfHostedSettings({ host: "code.example.com" }) }),
      ),
    );

    const provider = yield* discovery.refineUnknownRemote({
      cwd: "/repo",
      context: {
        provider: {
          kind: SourceControlProviderKind.make("unknown"),
          name: "code.example.com",
          baseUrl: "https://code.example.com",
        },
        remoteName: "origin",
        remoteUrl: "git@code.example.com:sam/t3code.git",
      },
    });

    assert.deepStrictEqual(provider, {
      kind: "gitlab",
      name: "GitLab Self-Hosted",
      baseUrl: "https://code.example.com",
    });
  }),
);

it.effect("opens the saved server's web address, not the remote's SSH port", () =>
  Effect.gen(function* () {
    const discovery = yield* GitLabSourceControlProvider.makeDiscovery.pipe(
      Effect.provide(
        TestSourceControlHost.layer({
          settings: selfHostedSettings({ host: "https://gitlab.example.com:8443/" }),
        }),
      ),
    );

    const provider = yield* discovery.refineUnknownRemote({
      cwd: "/repo",
      context: {
        provider: {
          kind: SourceControlProviderKind.make("unknown"),
          name: "gitlab.example.com",
          baseUrl: "https://gitlab.example.com:2222",
        },
        remoteName: "origin",
        remoteUrl: "ssh://git@gitlab.example.com:2222/sam/t3code.git",
      },
    });

    assert.deepStrictEqual(provider, {
      kind: "gitlab",
      name: "GitLab Self-Hosted",
      baseUrl: "https://gitlab.example.com:8443",
    });
  }),
);

it.effect("asks glab about the saved server alone, with the saved token", () =>
  Effect.gen(function* () {
    const runs: Array<{ readonly args: ReadonlyArray<string>; readonly env: unknown }> = [];
    const discovery = yield* GitLabSourceControlProvider.makeDiscovery.pipe(
      Effect.provide(
        TestSourceControlHost.layer({
          settings: selfHostedSettings({ host: "gitlab.example.com", token: "glpat-saved" }),
          process: {
            run: (input) =>
              Effect.sync(() => {
                runs.push({ args: input.args, env: input.env });
                return processOutput(
                  input.args[0] === "--version"
                    ? "glab 1.60.0"
                    : "gitlab.example.com\n  ✓ Logged in to gitlab.example.com as sam (GITLAB_TOKEN)\n",
                );
              }),
          },
        }),
      ),
    );

    const item = yield* discovery.probe("/repo");

    assert.deepStrictEqual(
      { status: item.auth.status, account: item.auth.account, host: item.auth.host },
      {
        status: "authenticated",
        account: Option.some("sam"),
        host: Option.some("gitlab.example.com"),
      },
    );
    assert.deepStrictEqual(runs.at(-1), {
      args: ["auth", "status", "--hostname", "gitlab.example.com"],
      env: { GITLAB_TOKEN: "glpat-saved", GITLAB_HOST: "https://gitlab.example.com" },
    });
  }),
);

it.effect("names the remote's server on each glab call, so a saved token can apply", () =>
  Effect.gen(function* () {
    const hosts: Array<string | undefined> = [];
    const provider = yield* makeProvider({
      listMergeRequests: (input) =>
        Effect.sync(() => {
          hosts.push(input.host);
          return [];
        }),
      getDefaultBranch: (input) =>
        Effect.sync(() => {
          hosts.push(input.host);
          return "main";
        }),
    });
    const context = {
      provider: {
        kind: SourceControlProviderKind.make("gitlab"),
        name: "GitLab Self-Hosted",
        baseUrl: "https://gitlab.example.com",
      },
      remoteName: "origin",
      remoteUrl: "git@gitlab.example.com:sam/t3code.git",
    };

    yield* provider.listChangeRequests({
      cwd: "/repo",
      context,
      headSelector: "feature/self-hosted",
      state: "open",
    });
    yield* provider.getDefaultBranch({ cwd: "/repo", context });
    yield* provider.getDefaultBranch({ cwd: "/repo" });

    assert.deepStrictEqual(hosts, ["gitlab.example.com", "gitlab.example.com", undefined]);
  }),
);
