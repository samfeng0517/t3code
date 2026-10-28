import { EnvironmentId, type ServerSelfUpdateCapability } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectRestartingMachines,
  collectServerUpdateTargets,
  describeUpdateEverything,
  getUpdateEverythingToastView,
  runUpdateEverything,
  type UpdateEverythingMachine,
} from "./updateEverything.logic";

function machine(
  id: string,
  serverVersion: string,
  selfUpdate: ServerSelfUpdateCapability | undefined,
  overrides: Partial<UpdateEverythingMachine> = {},
): UpdateEverythingMachine {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion,
        capabilities: {
          repositoryIdentity: true,
          ...(selfUpdate ? { serverSelfUpdate: selfUpdate } : {}),
          ...(selfUpdate === "desktop-managed" ? { desktopAppUpdate: true } : {}),
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
    ...overrides,
  };
}

const updateTargetMachines = (): UpdateEverythingMachine[] => [
  machine("this-app", "0.0.40", "desktop-managed", { hostedByThisApp: true }),
  machine("service", "0.0.40", "boot-service"),
  machine("nightly-service", "0.0.49-nightly.20261001.3", "boot-service"),
  machine("other-desktop", "0.0.49-nightly.20261001.3", "desktop-managed"),
  machine("offline", "0.0.40", "boot-service", { connected: false }),
  machine("never-connected", "0.0.40", "boot-service", { serverConfig: null }),
  machine("no-scope", "0.0.40", "boot-service", { canMaintain: false }),
  machine("busy", "0.0.40", "boot-service", {
    updateState: {
      status: "running",
      stage: "downloading",
      fromVersion: "0.0.40",
      targetVersion: "0.0.50",
    },
  }),
  machine("current", "0.0.50", "boot-service"),
  machine("current-offline", "0.0.50", "boot-service", { connected: false }),
  machine("manual", "0.0.40", undefined),
];

describe("collectServerUpdateTargets", () => {
  it("updates remote servers that can move to the target and names every skipped one", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      updateTargetMachines(),
      "0.0.50",
      undefined,
      true,
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["service", "0.0.50"],
      ["other-desktop", "0.0.50"],
    ]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["nightly-service", "on the nightly channel"],
      ["offline", "not connected"],
      ["never-connected", "not connected"],
      ["no-scope", "no permission"],
      ["busy", "already updating"],
      ["manual", "needs a manual update"],
    ]);
  });

  it("leaves every server alone on a fork build", () => {
    expect(collectServerUpdateTargets(updateTargetMachines(), "0.0.50", undefined, false)).toEqual({
      targets: [],
      skipped: [],
    });
  });
});

describe("collectRestartingMachines", () => {
  it("lists updated servers, and this app's servers only when it installs", () => {
    const withContinuation = (
      id: string,
      overrides: Partial<UpdateEverythingMachine> = {},
      enabled = false,
    ) => {
      const base = machine(id, "0.0.40", "boot-service", overrides);
      return {
        ...base,
        serverConfig: {
          environment: {
            ...base.serverConfig!.environment,
            capabilities: {
              ...base.serverConfig!.environment.capabilities,
              threadRestartContinuation: true,
            },
          },
          settings: { continueThreadsAfterServerUpdate: enabled },
        },
      };
    };
    const machines = [
      withContinuation("this-app", { hostedByThisApp: true }, true),
      withContinuation("alvin", {}, true),
      withContinuation("opted-out", {}, false),
      machine("old", "0.0.40", "boot-service"),
      withContinuation("providers-only"),
    ];
    const servers = ["alvin", "opted-out", "old"].map((id) => ({
      environmentId: EnvironmentId.make(id),
    }));

    expect(collectRestartingMachines(machines, servers, true)).toEqual([
      { environmentId: "this-app", continuesThreads: true },
      { environmentId: "alvin", continuesThreads: true },
      { environmentId: "opted-out", continuesThreads: false },
      { environmentId: "old", continuesThreads: false },
    ]);
    expect(
      collectRestartingMachines(machines, servers, false).map((entry) => entry.environmentId),
    ).toEqual(["alvin", "opted-out", "old"]);
  });
});

describe("runUpdateEverything", () => {
  it("still updates remote machines when the local download fails", async () => {
    const calls: string[] = [];
    const result = await runUpdateEverything({
      downloadLocal: async () => false,
      updateProviders: async () => {
        calls.push("providers");
      },
      updateServers: async () => {
        calls.push("servers");
      },
    });

    expect(calls).toEqual(["providers", "servers"]);
    expect(result.localReady).toBe(false);
  });
});

describe("update everything copy", () => {
  it("summarizes the plan and the result as English lists", () => {
    const plan = describeUpdateEverything({
      localVersion: "0.0.50",
      servers: [
        {
          environmentId: EnvironmentId.make("alvin"),
          serverLabel: "alvin",
          selfUpdate: "boot-service",
          targetVersion: "0.0.50",
        },
        {
          environmentId: EnvironmentId.make("mac"),
          serverLabel: "mac",
          selfUpdate: "desktop-managed",
          targetVersion: "0.0.50",
        },
      ],
      providerMachines: [
        {
          environmentId: EnvironmentId.make("alvin"),
          label: "alvin",
          providers: ["Codex", "Claude"],
        },
      ],
    });
    expect(plan).toEqual({
      summary: "Update this app, 2 servers, and 2 providers",
      items: "this app, 2 servers, and 2 providers",
      lines: [
        "This app: 0.0.50, restarts last",
        "alvin: server to 0.0.50, Codex, Claude",
        "mac: desktop app update",
      ],
    });

    expect(
      getUpdateEverythingToastView(
        {
          localVersion: "0.0.50",
          updatedServers: 1,
          updatedProviders: 0,
          failures: ["mac: timed out"],
          restarting: ["alvin"],
        },
        "0.0.50",
      ),
    ).toEqual({
      type: "error",
      title: "Updated this app and 1 server",
      description: "mac: timed out\nalvin is still restarting.",
    });
  });
});
