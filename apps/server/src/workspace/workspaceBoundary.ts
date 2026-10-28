import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

const canonicalizePath = Effect.fn("WorkspaceBoundary.canonicalizePath")(function* (value: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedPath = path.resolve(value);
  return yield* fileSystem.realPath(resolvedPath).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(resolvedPath)
          : Effect.fail(
              new VcsRepositoryDetectionError({
                operation: "WorkspaceBoundary.canonicalizePath",
                cwd: resolvedPath,
                detail: "Failed to resolve a path while validating the workspace.",
                cause,
              }),
            ),
    }),
  );
});

/**
 * Fails unless `cwd` resolves inside the server's workspace root or a known
 * workspace, so a client cannot point a read at an arbitrary directory.
 */
export const assertWorkspaceBoundCwd = Effect.fn("WorkspaceBoundary.assertWorkspaceBoundCwd")(
  function* (operation: string, cwd: string, detail: string) {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
    const [candidate, workspaceRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
    ]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, workspaceRoot) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({ operation, cwd, detail });
  },
);
