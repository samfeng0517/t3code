import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { T3_PROJECT_FILE_NAME, type ProjectReadCompatScriptsResult } from "@t3tools/contracts";

import {
  ORCA_YAML_FILE,
  SUPERSET_CONFIG_FILE,
  SUPERSET_LOCAL_CONFIG_FILE,
  SUPERSET_SCRIPT_KEYS,
  mergeSupersetConfig,
  orcaProjectScripts,
  parseOrcaYaml,
  parseSupersetConfig,
  parseSupersetLocalConfig,
  shebangShellOptions,
  supersetProjectScripts,
  type CompatProjectScripts,
  type SupersetScriptKey,
} from "./compatProjectFiles.ts";

export class CompatProjectConfig extends Context.Service<
  CompatProjectConfig,
  {
    /**
     * Never fails: a t3.json in `workspaceRoot` wins outright, then orca.yaml, then
     * .superset/config.json. Unreadable or invalid files, and an orca.yaml without scripts, count
     * as absent. Nothing here runs a script: they only become runnable once the user imports them.
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<CompatProjectScripts | null>;
    readonly readScripts: (workspaceRoot: string) => Effect.Effect<ProjectReadCompatScriptsResult>;
  }
>()("t3/project/CompatProjectConfig") {}

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readOptional = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.map((contents): string | null => contents),
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.logWarning("Could not read project file", { filePath, error }).pipe(
              Effect.as(null),
            ),
      ),
    );

  const exists = (filePath: string) =>
    fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));

  const loadOrca = Effect.fn("CompatProjectConfig.loadOrca")(function* (workspaceRoot: string) {
    const filePath = path.join(workspaceRoot, ORCA_YAML_FILE);
    const contents = yield* readOptional(filePath);
    if (contents === null) return null;
    const config = parseOrcaYaml(contents);
    if (config === null) {
      yield* Effect.logWarning("orca.yaml is invalid and is ignored", { filePath });
      return null;
    }
    for (const script of [config.setup, config.archive]) {
      const rejected = script ? shebangShellOptions(script).rejected : [];
      if (rejected.length > 0) {
        yield* Effect.logDebug("orca.yaml #! options are not replayed", { filePath, rejected });
      }
    }
    const scripts = orcaProjectScripts(config);
    // Only shared directories: Superset scripts, if any, still apply.
    return scripts.scripts.length === 0 ? null : scripts;
  });

  const loadSuperset = Effect.fn("CompatProjectConfig.loadSuperset")(function* (
    workspaceRoot: string,
  ) {
    const configPath = path.join(workspaceRoot, SUPERSET_CONFIG_FILE);
    const committed = yield* readOptional(configPath);
    const base = committed === null ? null : parseSupersetConfig(committed);
    if (committed !== null && base === null) {
      yield* Effect.logWarning(".superset/config.json is invalid and is ignored", {
        filePath: configPath,
      });
    }
    const local = yield* readOptional(path.join(workspaceRoot, SUPERSET_LOCAL_CONFIG_FILE));
    const merged = mergeSupersetConfig(
      base ?? {},
      local === null ? null : parseSupersetLocalConfig(local),
    );
    const fallbacks = new Set<SupersetScriptKey>();
    for (const key of SUPERSET_SCRIPT_KEYS) {
      if (
        (merged[key]?.length ?? 0) === 0 &&
        (yield* exists(path.join(workspaceRoot, `.superset/${key}.sh`)))
      ) {
        fallbacks.add(key);
      }
    }
    const scripts = supersetProjectScripts(merged, fallbacks);
    return scripts.scripts.length === 0 ? null : scripts;
  });

  const load: CompatProjectConfig["Service"]["load"] = Effect.fn("CompatProjectConfig.load")(
    function* (workspaceRoot) {
      if (yield* exists(path.join(workspaceRoot, T3_PROJECT_FILE_NAME))) return null;
      return (yield* loadOrca(workspaceRoot)) ?? (yield* loadSuperset(workspaceRoot));
    },
  );

  const readScripts: CompatProjectConfig["Service"]["readScripts"] = Effect.fn(
    "CompatProjectConfig.readScripts",
  )(function* (workspaceRoot) {
    const loaded = yield* load(workspaceRoot);
    return loaded === null
      ? { source: null, scripts: [] }
      : { source: loaded.source, scripts: loaded.scripts };
  });

  return CompatProjectConfig.of({ load, readScripts });
});

export const layer = Layer.effect(CompatProjectConfig, make);
