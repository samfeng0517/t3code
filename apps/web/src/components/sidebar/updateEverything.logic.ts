import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { APP_SELF_UPDATE_ENABLED } from "@t3tools/shared/appSelfUpdate";
import { cliReleaseChannelOf } from "@t3tools/shared/cliRelease";

import type { MessageKey, Translate } from "~/i18n";
import { formatMessage } from "~/i18n/locale";
import { en } from "~/i18n/messages/en";
import {
  resolveServerSelfUpdateCapability,
  resolveVersionMismatch,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "~/versionSkew";
import type { ServerUpdateOutcome, ServerUpdateTarget } from "../ServerUpdateAction";

// Default so these stay pure and testable; render and toast sites pass the active locale's `t`.
const translateEnglish: Translate = (key, params) => formatMessage(en[key], params);

export interface UpdateEverythingMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: {
    readonly environment: ServerConfig["environment"];
    readonly settings: Pick<ServerConfig["settings"], "continueThreadsAfterServerUpdate">;
  } | null;
  readonly connected: boolean;
  readonly hostedByThisApp: boolean;
  readonly canMaintain: boolean;
  readonly updateState: ServerUpdateState;
}

export interface RestartingMachine {
  readonly environmentId: EnvironmentId;
  readonly continuesThreads: boolean;
}

export function collectRestartingMachines(
  machines: ReadonlyArray<UpdateEverythingMachine>,
  servers: ReadonlyArray<Pick<ServerUpdateTarget, "environmentId">>,
  installsLocal: boolean,
): RestartingMachine[] {
  const updated = new Set(servers.map((server) => server.environmentId));
  return machines.flatMap((machine) => {
    const config = machine.serverConfig;
    if (
      config === null ||
      !machine.connected ||
      !(updated.has(machine.environmentId) || (installsLocal && machine.hostedByThisApp))
    ) {
      return [];
    }
    return [
      {
        environmentId: machine.environmentId,
        continuesThreads:
          config.environment.capabilities.threadRestartContinuation === true &&
          config.settings.continueThreadsAfterServerUpdate === true,
      },
    ];
  });
}

export interface SkippedMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly reason: string;
}

/**
 * Two kinds are in neither list: servers already on the target, and servers this app hosts,
 * which would relaunch the app mid-run and update with the app's own install anyway. A
 * desktop-managed server follows its own app's update feed, so the channel rule does not apply
 * to it. A fork build updates no server, since each one would install an upstream release.
 */
export function collectServerUpdateTargets(
  machines: ReadonlyArray<UpdateEverythingMachine>,
  targetVersion: string,
  t: Translate = translateEnglish,
  appSelfUpdateEnabled: boolean = APP_SELF_UPDATE_ENABLED,
): { readonly targets: ServerUpdateTarget[]; readonly skipped: SkippedMachine[] } {
  const targets: ServerUpdateTarget[] = [];
  const skipped: SkippedMachine[] = [];
  if (!appSelfUpdateEnabled) return { targets, skipped };
  for (const machine of machines) {
    const config = machine.serverConfig;
    if (machine.hostedByThisApp) continue;
    if (
      config !== null &&
      resolveVersionMismatch(config.environment.serverVersion, targetVersion) === null
    ) {
      continue;
    }
    const skip = (reason: string) =>
      skipped.push({ environmentId: machine.environmentId, label: machine.label, reason });
    if (config === null || !machine.connected) {
      skip(t("sidebar.updateSkip.notConnected"));
      continue;
    }
    if (!machine.canMaintain) {
      skip(t("sidebar.updateSkip.noPermission"));
      continue;
    }
    if (machine.updateState.status === "running") {
      skip(t("sidebar.updateSkip.alreadyUpdating"));
      continue;
    }
    const selfUpdate = resolveServerSelfUpdateCapability(config);
    const desktopAppUpdate = supportsDesktopAppUpdate(config);
    if (selfUpdate === null) {
      skip(t("sidebar.updateSkip.manualUpdate"));
      continue;
    }
    if (selfUpdate === "desktop-managed" && !desktopAppUpdate) {
      skip(t("sidebar.updateSkip.newerDesktopApp"));
      continue;
    }
    const serverVersion = config.environment.serverVersion;
    if (
      selfUpdate !== "desktop-managed" &&
      cliReleaseChannelOf(serverVersion) !== cliReleaseChannelOf(targetVersion)
    ) {
      skip(t("sidebar.updateSkip.channel", { channel: cliReleaseChannelOf(serverVersion) }));
      continue;
    }
    targets.push({
      environmentId: machine.environmentId,
      serverLabel: machine.label,
      selfUpdate,
      installation: config.environment.capabilities.serverInstallation,
      desktopAppUpdate,
      threadContinuation: supportsServerUpdateThreadContinuation(config),
      continueThreadsAfterServerUpdate: config.settings.continueThreadsAfterServerUpdate ?? false,
      targetVersion,
    });
  }
  return { targets, skipped };
}

export interface UpdateEverythingSteps<Providers, Servers> {
  readonly downloadLocal?: () => Promise<boolean>;
  readonly updateProviders: () => Promise<Providers>;
  readonly updateServers: () => Promise<Servers>;
}

/** Finish provider installs before server restarts. Install this app last when localReady; failed
 * downloads skip only that install. */
export async function runUpdateEverything<Providers, Servers>(
  steps: UpdateEverythingSteps<Providers, Servers>,
): Promise<{
  readonly localReady: boolean;
  readonly providers: Providers;
  readonly servers: Servers;
}> {
  const [localReady, remote] = await Promise.all([
    steps.downloadLocal?.() ?? Promise.resolve(true),
    steps
      .updateProviders()
      .then(async (providers) => ({ providers, servers: await steps.updateServers() })),
  ]);
  return { localReady, ...remote };
}

export type UpdateRunMachineStatus =
  | "providers"
  | "waiting"
  | "downloading"
  | "restarting"
  | "done"
  | "failed";

export interface UpdateRunMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly updatesProviders: boolean;
  readonly server: ServerUpdateTarget | null;
  readonly handedOffVersion: string | null;
  readonly startedAt: number;
  readonly result: "done" | "failed" | null;
  readonly failure: string | null;
  readonly providerFailure: string | null;
}

export interface UpdateEverythingRun {
  readonly localVersion: string | null;
  readonly phase: "providers" | "servers" | "countdown" | "installing";
  readonly restartAt: number | null;
  readonly machines: ReadonlyArray<UpdateRunMachine>;
}

export function resolveUpdateRunMachineStatus(
  machine: UpdateRunMachine,
  phase: UpdateEverythingRun["phase"],
  serverState: ServerUpdateState,
): UpdateRunMachineStatus {
  if (machine.result !== null) return machine.result;
  if (machine.handedOffVersion !== null) return "restarting";
  if (phase === "providers" && machine.updatesProviders) return "providers";
  if (machine.server !== null && serverState.status === "running") {
    return serverState.stage === "resuming" ? "restarting" : "downloading";
  }
  return "waiting";
}

export function isServerUpdateHandedOff(state: ServerUpdateState): boolean {
  return state.status === "running" && state.stage === "resuming";
}

export function closeFinishedUpdateRun(run: UpdateEverythingRun): UpdateEverythingRun | null {
  return run.phase === "servers" &&
    run.localVersion === null &&
    run.machines.every((machine) => machine.result === "done")
    ? null
    : run;
}

const UPDATE_SLOW_AFTER_MS = 3 * 60 * 1000;

export function formatUpdateElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export interface UpdateRunMachineView {
  readonly machine: UpdateRunMachine;
  readonly status: UpdateRunMachineStatus;
}

export type UpdateRunLocalState =
  | { readonly status: "downloading"; readonly percent: number | null }
  | { readonly status: "waiting" }
  | null;

export interface UpdateCapsuleView {
  readonly tone: "default" | "slow" | "failed";
  readonly label: string;
  readonly slow?: { readonly status: string; readonly elapsed: string };
  readonly action: "later" | "retry" | "dismiss" | null;
}

const isActive = (status: UpdateRunMachineStatus) => status !== "done" && status !== "failed";

export function describeUpdateCapsule(
  run: UpdateEverythingRun,
  machines: ReadonlyArray<UpdateRunMachineView>,
  local: UpdateRunLocalState,
  now: number,
  t: Translate = translateEnglish,
): UpdateCapsuleView {
  if (run.phase === "countdown" && run.restartAt !== null) {
    const seconds = Math.max(0, Math.ceil((run.restartAt - now) / 1000));
    return {
      tone: "default",
      label: t("sidebar.updateCapsule.restartIn", { seconds }),
      action: "later",
    };
  }
  if (run.phase === "installing") {
    return { tone: "default", label: t("sidebar.updateCapsule.restarting"), action: null };
  }
  const active = machines.filter(({ status }) => isActive(status) && status !== "waiting");
  const slowest = active.toSorted((a, b) => a.machine.startedAt - b.machine.startedAt)[0];
  if (slowest && now - slowest.machine.startedAt >= UPDATE_SLOW_AFTER_MS) {
    return {
      tone: "slow",
      label: slowest.machine.label,
      slow: {
        status: t(RUN_STATUS_KEYS[slowest.status]),
        elapsed: formatUpdateElapsed(now - slowest.machine.startedAt),
      },
      action: null,
    };
  }
  const done = machines.filter(({ status }) => status === "done").length;
  const progress = t("sidebar.updateCapsule.progress", { done, total: machines.length });
  if (machines.some(({ status }) => isActive(status))) {
    return { tone: "default", label: progress, action: null };
  }
  if (local?.status === "downloading") {
    return {
      tone: "default",
      label:
        local.percent === null
          ? t("sidebar.updateCapsule.downloading")
          : t("sidebar.updateCapsule.downloadingPercent", { percent: Math.floor(local.percent) }),
      action: null,
    };
  }
  const failed = machines.filter(({ status }) => status === "failed");
  if (failed.length > 0) {
    return {
      tone: "failed",
      label:
        failed.length === 1
          ? t("sidebar.updateCapsule.machineFailed", { machine: failed[0]!.machine.label })
          : t("sidebar.updateCapsule.countFailed", { count: failed.length }),
      action: failed.some(({ machine }) => machine.server !== null) ? "retry" : "dismiss",
    };
  }
  return { tone: "default", label: progress, action: null };
}

export const RUN_STATUS_KEYS: Record<UpdateRunMachineStatus, MessageKey> = {
  providers: "sidebar.updateRun.status.providers",
  waiting: "sidebar.updateRun.status.waiting",
  downloading: "sidebar.updateRun.status.downloading",
  restarting: "sidebar.updateRun.status.restarting",
  done: "sidebar.updateRun.status.done",
  failed: "sidebar.updateRun.status.failed",
};

export interface UpdateEverythingResult {
  readonly localVersion: string | null;
  readonly updatedServers: number;
  readonly updatedProviders: number;
  readonly failures: ReadonlyArray<string>;
  readonly restarting: ReadonlyArray<string>;
}

export function collectUpdateEverythingResult(
  input: {
    readonly localVersion: string | null;
    readonly localFailures: ReadonlyArray<string>;
    readonly servers: ReadonlyArray<{
      readonly label: string;
      readonly outcome: ServerUpdateOutcome;
    }>;
    readonly providers: ReadonlyArray<
      | { readonly status: "interrupted" | "updated" }
      | { readonly status: "failed"; readonly line: string }
    >;
  },
  t: Translate = translateEnglish,
): UpdateEverythingResult {
  return {
    localVersion: input.localVersion,
    updatedServers: input.servers.filter(({ outcome }) => outcome.status === "updated").length,
    updatedProviders: input.providers.filter((outcome) => outcome.status === "updated").length,
    restarting: [],
    failures: [
      ...input.localFailures.map((failure) =>
        t("sidebar.updateSummary.labeledLine", {
          label: t("sidebar.updateRun.thisApp"),
          detail: failure,
        }),
      ),
      ...input.servers.flatMap(({ label, outcome }) =>
        outcome.status === "failed"
          ? [t("sidebar.updateSummary.labeledLine", { label, detail: outcome.message })]
          : [],
      ),
      ...input.providers.flatMap((outcome) => (outcome.status === "failed" ? [outcome.line] : [])),
    ],
  };
}

export function getUpdateEverythingToastView(
  result: UpdateEverythingResult,
  appVersion: string,
  t: Translate = translateEnglish,
): {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description?: string;
} | null {
  const parts = [
    result.localVersion !== null && result.localVersion === appVersion
      ? t("sidebar.updateSummary.thisApp")
      : null,
    countLabel(t, result.updatedServers, "sidebar.updateSummary.servers"),
    countLabel(t, result.updatedProviders, "sidebar.updateSummary.providers"),
  ].filter((part) => part !== null);
  const restarting =
    result.restarting.length === 0
      ? []
      : [
          t(
            result.restarting.length === 1
              ? "sidebar.updateSummary.stillRestarting.one"
              : "sidebar.updateSummary.stillRestarting.other",
            { machines: joinList(t, result.restarting) },
          ),
        ];
  const updated = t("sidebar.updateSummary.updated", { items: joinList(t, parts) });
  if (result.failures.length === 0) {
    if (parts.length === 0) return null;
    return {
      type: "success",
      title: updated,
      ...(restarting.length === 0 ? {} : { description: restarting.join("\n") }),
    };
  }
  return {
    type: "error",
    title: parts.length === 0 ? t("sidebar.updateSummary.failed") : updated,
    description: [...result.failures, ...restarting].join("\n"),
  };
}

export interface UpdateEverythingPlan {
  readonly localVersion: string | null;
  readonly servers: ReadonlyArray<
    Pick<ServerUpdateTarget, "environmentId" | "serverLabel" | "selfUpdate" | "targetVersion">
  >;
  readonly providerMachines: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly providers: ReadonlyArray<string>;
  }>;
}

function countLabel(
  t: Translate,
  count: number,
  key: "sidebar.updateSummary.servers" | "sidebar.updateSummary.providers",
): string | null {
  if (count === 0) return null;
  return t(count === 1 ? `${key}.one` : `${key}.other`, { count });
}

function joinList(t: Translate, parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) {
    return t("sidebar.updateSummary.listPair", { first: parts[0]!, second: parts[1]! });
  }
  return t("sidebar.updateSummary.listLast", {
    items: parts.slice(0, -1).join(t("sidebar.updateSummary.listSeparator")),
    last: parts.at(-1)!,
  });
}

export function describeUpdateEverything(
  plan: UpdateEverythingPlan,
  t: Translate = translateEnglish,
): {
  readonly summary: string;
  readonly items: string;
  readonly lines: ReadonlyArray<string>;
} {
  const providerCount = plan.providerMachines.reduce(
    (count, machine) => count + machine.providers.length,
    0,
  );
  const items = joinList(
    t,
    [
      plan.localVersion ? t("sidebar.updateSummary.thisApp") : null,
      countLabel(t, plan.servers.length, "sidebar.updateSummary.servers"),
      countLabel(t, providerCount, "sidebar.updateSummary.providers"),
    ].filter((part) => part !== null),
  );
  const summary = t("sidebar.updateSummary.update", { items });

  const machines = new Map<EnvironmentId, { label: string; items: string[] }>();
  const itemsFor = (environmentId: EnvironmentId, label: string) => {
    const existing = machines.get(environmentId);
    if (existing) return existing.items;
    const items: string[] = [];
    machines.set(environmentId, { label, items });
    return items;
  };
  for (const server of plan.servers) {
    itemsFor(server.environmentId, server.serverLabel).push(
      server.selfUpdate === "desktop-managed"
        ? t("sidebar.updateSummary.desktopAppUpdate")
        : t("sidebar.updateSummary.serverTo", { version: server.targetVersion }),
    );
  }
  for (const machine of plan.providerMachines) {
    itemsFor(machine.environmentId, machine.label).push(...machine.providers);
  }

  return {
    summary,
    items,
    lines: [
      ...(plan.localVersion
        ? [t("sidebar.updateSummary.thisAppLine", { version: plan.localVersion })]
        : []),
      ...Array.from(machines.values(), ({ label, items }) =>
        t("sidebar.updateSummary.labeledLine", {
          label,
          detail: items.join(t("sidebar.updateSummary.listSeparator")),
        }),
      ),
    ],
  };
}
