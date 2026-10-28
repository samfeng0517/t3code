import {
  EMPTY_SHELL_STATE,
  type EnvironmentProject,
  type EnvironmentShellState,
  type EnvironmentShellStatus,
} from "@t3tools/client-runtime/state/shell";
import { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { resolveGitTabProject } from "./gitTabProject";

const project = { title: "t3code" } as EnvironmentProject;
const snapshot = Schema.decodeSync(OrchestrationV2ShellSnapshot)({
  schemaVersion: 1,
  snapshotSequence: 0,
  threads: [],
  archivedThreads: [],
  projects: [],
});
const shellWithSnapshot = (status: EnvironmentShellStatus): EnvironmentShellState => ({
  ...EMPTY_SHELL_STATE,
  status,
  snapshot: Option.some(snapshot),
  error: Option.none(),
});
const liveShell = shellWithSnapshot("live");
const cachedShell = shellWithSnapshot("cached");

describe("resolveGitTabProject", () => {
  it("should report loading when the project is absent before its environment's projects are known", () => {
    expect(
      resolveGitTabProject({
        project: null,
        allSnapshotsReady: false,
        shell: cachedShell,
      }),
    ).toEqual({ status: "loading" });
  });

  it("should report missing when the project is absent from a live environment", () => {
    expect(
      resolveGitTabProject({ project: null, allSnapshotsReady: false, shell: liveShell }),
    ).toEqual({ status: "missing" });
  });

  it("should report missing when the project is absent once every environment's projects are ready", () => {
    expect(
      resolveGitTabProject({ project: null, allSnapshotsReady: true, shell: cachedShell }),
    ).toEqual({ status: "missing" });
  });

  it("should report the project when it exists even before its environment is live", () => {
    expect(resolveGitTabProject({ project, allSnapshotsReady: false, shell: cachedShell })).toEqual(
      { status: "ready", project },
    );
  });
});
