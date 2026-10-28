import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as CompatProjectConfig from "./CompatProjectConfig.ts";

const layerTest = CompatProjectConfig.layer.pipe(Layer.provideMerge(NodeServices.layer));

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-compat-project-" });
});

const writeFile = Effect.fn("writeFile")(function* (
  root: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(root, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

it.layer(layerTest)("CompatProjectConfig", (it) => {
  describe("readScripts", () => {
    it.effect("prefers t3.json, then orca.yaml, then .superset/config.json", () =>
      Effect.gen(function* () {
        const compat = yield* CompatProjectConfig.CompatProjectConfig;
        const root = yield* makeTempDir;
        expect(yield* compat.readScripts(root)).toEqual({ source: null, scripts: [] });

        yield* writeFile(root, ".superset/config.json", JSON.stringify({ run: ["pnpm dev"] }));
        expect(yield* compat.readScripts(root)).toEqual({
          source: ".superset/config.json",
          scripts: [{ name: "Superset run", command: "pnpm dev", icon: "play" }],
        });

        yield* writeFile(
          root,
          "orca.yaml",
          "defaultTabs:\n  - title: Dev\n    command: pnpm dev\n",
        );
        expect((yield* compat.readScripts(root)).source).toBe("orca.yaml");

        // An invalid orca.yaml counts as absent rather than hiding the Superset config.
        yield* writeFile(root, "orca.yaml", "scripts:\n  setup: a\n  setup: b\n");
        expect((yield* compat.readScripts(root)).source).toBe(".superset/config.json");

        // Even an invalid t3.json wins: its own warning tells the user what to fix.
        yield* writeFile(root, "t3.json", "{ nope");
        expect(yield* compat.readScripts(root)).toEqual({ source: null, scripts: [] });
      }),
    );

    it.effect("applies config.local.json and the .sh fallbacks", () =>
      Effect.gen(function* () {
        const compat = yield* CompatProjectConfig.CompatProjectConfig;
        const root = yield* makeTempDir;
        yield* writeFile(root, ".superset/config.json", JSON.stringify({ setup: ["pnpm i"] }));
        yield* writeFile(
          root,
          ".superset/config.local.json",
          JSON.stringify({ setup: { after: ["cp ~/.env ."] } }),
        );
        yield* writeFile(root, ".superset/run.sh", "pnpm dev\n");

        expect((yield* compat.readScripts(root)).scripts).toEqual([
          {
            name: "Superset setup",
            command: "pnpm i && cp ~/.env .",
            icon: "configure",
            runOnWorktreeCreate: true,
            async: true,
          },
          { name: "Superset run", command: "bash .superset/run.sh", icon: "play" },
        ]);
      }),
    );
  });

  describe("precedence fallbacks", () => {
    it.effect("uses Superset scripts when orca.yaml only shares directories", () =>
      Effect.gen(function* () {
        const compat = yield* CompatProjectConfig.CompatProjectConfig;
        const root = yield* makeTempDir;
        yield* writeFile(root, "orca.yaml", "worktree:\n  sharedDirectories: [.cache]\n");
        yield* writeFile(
          root,
          ".superset/config.json",
          JSON.stringify({ teardown: ["docker compose down"] }),
        );
        expect(yield* compat.readScripts(root)).toEqual({
          source: ".superset/config.json",
          scripts: [
            {
              name: "Superset teardown",
              command: "docker compose down",
              icon: "configure",
              runOnWorktreeRemove: true,
            },
          ],
        });
      }),
    );

    it.effect("ignores a Superset config whose cwd leaves the repository", () =>
      Effect.gen(function* () {
        const compat = yield* CompatProjectConfig.CompatProjectConfig;
        const root = yield* makeTempDir;
        yield* writeFile(
          root,
          ".superset/config.json",
          JSON.stringify({ run: ["pnpm dev"], cwd: "../elsewhere" }),
        );
        expect(yield* compat.readScripts(root)).toEqual({ source: null, scripts: [] });
      }),
    );
  });
});
