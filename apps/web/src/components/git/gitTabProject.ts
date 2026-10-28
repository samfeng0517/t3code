import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import * as Option from "effect/Option";

import { useAllEnvironmentProjectSnapshotsReady, useProject } from "~/state/entities";
import { environmentShell } from "~/state/shell";

import type { GitTab } from "./gitTabsStore";

export type GitTabProject =
  | { readonly status: "ready"; readonly project: EnvironmentProject }
  | { readonly status: "loading" }
  | { readonly status: "missing" };

/**
 * A missing project only proves it was removed once its environment's projects have loaded;
 * until then (or while that environment is offline) the tab must not claim it is gone.
 */
export function resolveGitTabProject(input: {
  readonly project: EnvironmentProject | null;
  readonly allSnapshotsReady: boolean;
  readonly shell: EnvironmentShellState;
}): GitTabProject {
  if (input.project !== null) return { status: "ready", project: input.project };
  const projectsKnown =
    input.allSnapshotsReady ||
    (input.shell.status === "live" && Option.isSome(input.shell.snapshot));
  return projectsKnown ? { status: "missing" } : { status: "loading" };
}

export function useGitTabProject(tab: GitTab): GitTabProject {
  return resolveGitTabProject({
    project: useProject(tab),
    allSnapshotsReady: useAllEnvironmentProjectSnapshotsReady(),
    shell: useAtomValue(environmentShell.stateValueAtom(tab.environmentId)),
  });
}
