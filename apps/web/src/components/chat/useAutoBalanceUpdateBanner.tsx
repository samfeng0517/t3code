import { useAtomValue } from "@effect/atom-react";
import { useT } from "~/i18n";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { useState } from "react";

import { environmentIdsKey } from "~/state/environmentAtomList";
import type { EnvironmentPresentation } from "~/state/environments";
import { environmentUpdateStatesAtom } from "~/state/server";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "~/versionSkew";
import {
  ServerUpdateAction,
  ServerUpdateProgress,
  ServerUpdatesAction,
} from "../ServerUpdateAction";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerServerUpdateIcon } from "./ComposerServerUpdateStatus";

export function useAutoBalanceUpdateBanner(
  environments: readonly EnvironmentPresentation[],
): ComposerBannerStackItem | null {
  const t = useT();
  const updateStates = useAtomValue(
    environmentUpdateStatesAtom(
      environmentIdsKey(environments.map(({ environmentId }) => environmentId)),
    ),
  );
  const states = environments.flatMap((environment, index) => {
    const state = updateStates[index];
    return state ? [{ environment, state }] : [];
  });
  const [dismissedNotices, setDismissedNotices] = useState<ReadonlySet<string | ServerUpdateState>>(
    () => new Set(),
  );
  const machines = states.flatMap(({ environment, state }) => {
    const mismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
    const dismissKey = mismatch
      ? buildVersionMismatchDismissalKey(environment.environmentId, mismatch)
      : null;
    if (
      state.status === "idle"
        ? !mismatch ||
          (dismissKey !== null && dismissedNotices.has(dismissKey)) ||
          isVersionMismatchDismissed(dismissKey)
        : dismissedNotices.has(state) || isServerUpdateFailureDismissed(state)
    )
      return [];
    const selfUpdate = resolveServerSelfUpdateCapability(environment.serverConfig);
    const desktopAppUpdate = supportsDesktopAppUpdate(environment.serverConfig);
    return [
      {
        environmentId: environment.environmentId,
        serverLabel: environment.label,
        selfUpdate,
        installation: environment.serverConfig?.environment.capabilities.serverInstallation,
        desktopAppUpdate,
        targetVersion: state.status === "idle" ? mismatch!.clientVersion : state.targetVersion,
        connected: environment.connection.phase === "connected",
        remoteUpdate: selfUpdate !== null && (selfUpdate !== "desktop-managed" || desktopAppUpdate),
        state,
        dismissKey,
      },
    ];
  });
  if (machines.length === 0) return null;

  const running = machines.filter((machine) => machine.state.status === "running").length;
  const failed = machines.filter((machine) => machine.state.status === "failed").length;
  const manual = machines.filter((machine) => !machine.remoteUpdate).length;
  const targets = machines.filter(
    (machine) => machine.connected && machine.remoteUpdate && machine.state.status !== "running",
  );
  const count = running || failed || machines.length;
  const status = running ? "running" : failed ? "failed" : "idle";
  const titleKey = running ? "updating" : failed ? "failed" : "available";
  const title = t(
    count === 1
      ? `legacySidebar.misc.serverUpdateBanner.${titleKey}.one`
      : `legacySidebar.misc.serverUpdateBanner.${titleKey}.other`,
    { count },
  );
  return {
    id: `auto-balance-server-updates-${dismissedNotices.size}`,
    variant: failed ? "error" : "default",
    group: "environment",
    icon: <ComposerServerUpdateIcon status={status} />,
    title: (
      <Popover>
        <PopoverTrigger
          render={<InlineButton />}
          className="max-w-full"
          aria-label={t("legacySidebar.misc.serverUpdateBanner.viewMachines", { title })}
        >
          <span className="min-w-0 truncate">{title}</span>
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" width="md">
          <div className="space-y-3 text-xs">
            {machines.map((machine) => (
              <div key={machine.environmentId} className="space-y-1">
                <div className="font-medium">{machine.serverLabel}</div>
                {machine.state.status !== "idle" ? (
                  <ServerUpdateProgress state={machine.state} />
                ) : !machine.remoteUpdate ? (
                  <>
                    <div className="text-muted-foreground">
                      {t("legacySidebar.misc.serverUpdateBanner.manualRequired")}
                    </div>
                    <ServerUpdateAction {...machine} />
                  </>
                ) : (
                  <div className="text-muted-foreground">
                    {machine.connected
                      ? t("legacySidebar.misc.serverUpdateBanner.readyToUpdate", {
                          version: machine.targetVersion,
                        })
                      : t("legacySidebar.misc.serverUpdateBanner.reconnect")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    ),
    description:
      manual > 0
        ? t(
            manual === 1
              ? "legacySidebar.misc.serverUpdateBanner.manualDescription.one"
              : "legacySidebar.misc.serverUpdateBanner.manualDescription.other",
            { count: manual },
          )
        : undefined,
    actions:
      running === 0 && targets.length > 0 ? (
        <ServerUpdatesAction
          targets={targets}
          variant="ghost"
          label={
            failed > 0
              ? t("legacySidebar.misc.serverUpdateBanner.retry")
              : targets.length === machines.length
                ? t("legacySidebar.misc.serverUpdateBanner.updateAll")
                : t(
                    targets.length === 1
                      ? "legacySidebar.misc.serverUpdateBanner.updateCount.one"
                      : "legacySidebar.misc.serverUpdateBanner.updateCount.other",
                    { count: targets.length },
                  )
          }
        />
      ) : undefined,
    dismissLabel: t("legacySidebar.misc.serverUpdateBanner.dismiss"),
    ...(running
      ? {}
      : {
          onDismiss: () => {
            const next = new Set(dismissedNotices);
            for (const { state, dismissKey } of machines) {
              dismissServerUpdateFailure(state);
              dismissVersionMismatch(dismissKey);
              if (dismissKey) next.add(dismissKey);
              if (state.status === "failed") next.add(state);
            }
            setDismissedNotices(next);
          },
        }),
  };
}
