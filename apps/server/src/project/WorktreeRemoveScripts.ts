import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  projectScriptRuntimeEnv,
  resolveProjectScripts,
  worktreeRemoveProjectScript,
} from "@t3tools/shared/projectScripts";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectService from "./ProjectService.ts";

// Removal waits for the action, so a hung `docker compose down` must not hold it forever.
const REMOVE_SCRIPT_TIMEOUT = "60 seconds";
const REMOVE_SCRIPT_OUTPUT_MAX_BYTES = 64 * 1024;

export interface WorktreeRemoveScriptInput {
  /** The project's main checkout. */
  readonly projectRoot: string;
  readonly worktreePath: string;
}

export class WorktreeRemoveScripts extends Context.Service<
  WorktreeRemoveScripts,
  {
    /**
     * Runs the project's own action marked `runOnWorktreeRemove` inside a linked worktree that is
     * about to be removed. Only actions saved in the project's settings run, never anything read
     * from files in the repository. Never fails: errors and timeouts are logged and removal goes on.
     */
    readonly runBeforeRemove: (input: WorktreeRemoveScriptInput) => Effect.Effect<void>;
  }
>()("t3/project/WorktreeRemoveScripts") {}

/** @public */
export const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const hostEnv = yield* HostProcess.Environment;

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => path.resolve(target)));

  /** The main checkout is listed first; only the others may run a removal action. */
  const isLinkedWorktree = Effect.fn("WorktreeRemoveScripts.isLinkedWorktree")(function* (
    projectRoot: string,
    worktreePath: string,
  ) {
    const listed = yield* git
      .listWorktreePaths(projectRoot)
      .pipe(Effect.orElseSucceed((): string[] => []));
    const [main, ...linked] = yield* Effect.forEach(listed, realPath);
    return (
      main !== undefined &&
      worktreePath !== main &&
      worktreePath !== (yield* realPath(projectRoot)) &&
      linked.includes(worktreePath)
    );
  });

  const shellCommand = (command: string) => {
    if (platform === "win32") {
      return { command: "powershell.exe", args: ["-NoProfile", "-Command", command] };
    }
    // Actions are written for the user's terminal shell, which is what runs them interactively.
    return { command: hostEnv.SHELL || "/bin/sh", args: ["-c", command] };
  };

  const runBeforeRemove: WorktreeRemoveScripts["Service"]["runBeforeRemove"] = Effect.fn(
    "WorktreeRemoveScripts.runBeforeRemove",
  )(
    function* (input) {
      const resolvedPath = path.resolve(input.projectRoot, input.worktreePath);
      if (!(yield* fileSystem.exists(resolvedPath).pipe(Effect.orElseSucceed(() => false)))) return;
      const project = yield* projects
        .getByWorkspaceRoot(input.projectRoot)
        .pipe(Effect.map(Option.getOrUndefined));
      if (project === undefined) return;
      const script = worktreeRemoveProjectScript(
        resolveProjectScripts(yield* serverSettings.getSettings, project),
      );
      if (script === null) return;
      const worktreePath = yield* realPath(resolvedPath);
      if (!(yield* isLinkedWorktree(input.projectRoot, worktreePath))) return;

      const result = yield* processRunner.run({
        ...shellCommand(script.command),
        cwd: worktreePath,
        env: {
          ...projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          }),
          NO_COLOR: "1",
        },
        timeout: REMOVE_SCRIPT_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: REMOVE_SCRIPT_OUTPUT_MAX_BYTES,
        outputMode: "truncate",
      });
      if (result.timedOut || result.code !== 0) {
        yield* Effect.logWarning("Worktree removal action failed; removing the worktree anyway", {
          scriptId: script.id,
          worktreePath,
          exitCode: result.code,
          timedOut: result.timedOut,
          stderr: result.stderr.slice(-2_000),
        });
      }
    },
    Effect.catch((error) => Effect.logWarning("Worktree removal action could not run", { error })),
  );

  return WorktreeRemoveScripts.of({ runBeforeRemove });
});

export const layer = Layer.effect(WorktreeRemoveScripts, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
