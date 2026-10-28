import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type Project,
  type ProjectScript,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as WorktreeRemoveScripts from "./WorktreeRemoveScripts.ts";

const PROJECT_ID = ProjectId.make("project-1");

const scripts: ReadonlyArray<ProjectScript> = [
  {
    id: "down",
    name: "Orca archive",
    command: 'echo "$ORCA_WORKSPACE_NAME|$ORCA_ROOT_PATH" > removed.txt',
    icon: "configure",
    runOnWorktreeCreate: false,
    runOnWorktreeRemove: true,
  },
  {
    id: "other",
    name: "Other",
    command: "touch other.txt",
    icon: "play",
    runOnWorktreeCreate: false,
  },
];

const layerFor = (
  projectRoot: { current: string },
  projectScripts: ReadonlyArray<ProjectScript> = scripts,
) =>
  WorktreeRemoveScripts.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getByWorkspaceRoot: (workspaceRoot) =>
          Effect.succeed(
            workspaceRoot === projectRoot.current
              ? Option.some({
                  id: PROJECT_ID,
                  workspaceRoot,
                  scripts: [],
                } as unknown as Project)
              : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: { [PROJECT_ID]: { defaultProjectScripts: projectScripts } },
        }),
      }),
    ),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-remove-scripts-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

it.effect("runs only the project's flagged action, only in a linked worktree", () => {
  const projectRoot = { current: "" };
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const runner = yield* WorktreeRemoveScripts.WorktreeRemoveScripts;
    const repo = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remove-repo-" });
    projectRoot.current = repo;
    const worktree = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "t3-remove-wt-" }),
      "feature-x",
    );
    const plain = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remove-plain-" });
    // A hook declared in the repository must never run on its own.
    yield* fs.writeFileString(
      path.join(repo, "orca.yaml"),
      "scripts:\n  archive: touch from-file.txt\n",
    );
    for (const args of [
      ["init", "-b", "main"],
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
      ["worktree", "add", "-b", "feature", worktree],
    ]) {
      yield* git.execute({ operation: "test.setup", cwd: repo, args });
    }

    yield* runner.runBeforeRemove({ projectRoot: repo, worktreePath: repo });
    yield* runner.runBeforeRemove({ projectRoot: repo, worktreePath: plain });
    yield* runner.runBeforeRemove({ projectRoot: repo, worktreePath: worktree });

    assert.equal(
      (yield* fs.readFileString(path.join(worktree, "removed.txt"))).trim(),
      `feature-x|${repo}`,
    );
    for (const dir of [repo, plain]) {
      assert.isFalse(yield* fs.exists(path.join(dir, "removed.txt")));
    }
    for (const file of ["other.txt", "from-file.txt"]) {
      assert.isFalse(yield* fs.exists(path.join(worktree, file)));
    }
  }).pipe(Effect.scoped, Effect.provide(layerFor(projectRoot)));
});

it.effect("stops running once the flagged action is deleted", () => {
  const projectRoot = { current: "" };
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const runner = yield* WorktreeRemoveScripts.WorktreeRemoveScripts;
    const repo = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remove-other-" });
    projectRoot.current = repo;
    const worktree = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "t3-wt-" }), "wt");
    for (const args of [
      ["init", "-b", "main"],
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
      ["worktree", "add", "-b", "feature", worktree],
    ]) {
      yield* git.execute({ operation: "test.setup", cwd: repo, args });
    }
    yield* runner.runBeforeRemove({ projectRoot: repo, worktreePath: worktree });
    assert.isFalse(yield* fs.exists(path.join(worktree, "removed.txt")));
    assert.isFalse(yield* fs.exists(path.join(worktree, "other.txt")));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      layerFor(
        projectRoot,
        scripts.filter((script) => script.runOnWorktreeRemove !== true),
      ),
    ),
  );
});
