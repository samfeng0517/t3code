import { SessionPermissions } from "./SessionPermissions";
import {
  ChevronRightIcon,
  ChevronsLeftRightEllipsisIcon,
  EllipsisIcon,
  RouteIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";
import {
  AuthRelayWriteScope,
  type EnvironmentId,
  connectReachabilityHelpUrl,
  formatConnectReachable,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  connectionRoutes,
  hasSavedBearerRoute,
  connectionStatusText,
  environmentMcpUrl,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";

import { t as translate, useT } from "~/i18n";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { SettingsRow } from "./settingsLayout";
import { EnvironmentIconMenu } from "./EnvironmentIconPicker";
import { EnvironmentRoutesList } from "./EnvironmentRoutesList";
import {
  ConnectionDiagnosisPanel,
  ConnectionDiagnosisSummary,
  useConnectionDiagnosis,
} from "./ConnectionDiagnosisDetails";
import { usePreparedConnection } from "~/state/session";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button, InlineButton } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import {
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "~/versionSkew";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { useCloudLinkController } from "~/cloud/useCloudLinkController";
import { useManagedTunnelUsage } from "~/cloud/managedRelayState";
import { useT3ConnectAccountPage } from "../clerk/T3ConnectAccountPages";
import { TunnelLimitAlert, TunnelUsageMeter } from "../cloud/TunnelUsage";
import { environmentCatalog } from "~/connection/catalog";
import { readEnvironmentScope } from "~/state/session";
import {
  type EnvironmentPresentation,
  useRelayEnvironmentDiscovery,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { APP_VERSION } from "~/branding";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "~/state/server";
import {
  OutdatedServerUpdateAction,
  ServerUpdateAction,
  ServerUpdateProgress,
} from "../ServerUpdateAction";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";

type SavedBackendListRowProps = {
  environment: EnvironmentPresentation;
  removingEnvironmentId: EnvironmentId | null;
  onSetEnabled: (environmentId: EnvironmentId, enabled: boolean) => void;
  onRemove: (environment: EnvironmentPresentation) => void;
  onAddRoute: (environment: EnvironmentPresentation) => void;
};

function savedBackendStatus(environment: EnvironmentPresentation): {
  readonly text: string;
  readonly tone: "muted" | "error";
} {
  if (!environment.entry.enabled && environment.connection.phase !== "unsupported")
    return { text: translate("settingsPages.connections.backend.off"), tone: "muted" };
  const { connection } = environment;
  switch (connection.phase) {
    case "connected":
      return { text: translate("settingsPages.connections.backend.connected"), tone: "muted" };
    case "connecting":
      return { text: translate("settingsPages.connections.backend.connecting"), tone: "muted" };
    case "reconnecting":
      return {
        text: connection.error
          ? translate("settingsPages.connections.backend.reconnectingError", {
              error: connection.error,
            })
          : translate("settingsPages.connections.backend.reconnecting"),
        tone: "error",
      };
    case "unsupported":
      return { text: translate("settingsPages.connections.backend.unsupported"), tone: "muted" };
    case "error":
      return {
        text: connection.error
          ? translate("settingsPages.connections.backend.failedError", { error: connection.error })
          : translate("settingsPages.connections.backend.failed"),
        tone: "error",
      };
    case "offline":
      return { text: translate("settingsPages.connections.backend.offline"), tone: "muted" };
    case "available":
      return { text: translate("settingsPages.connections.backend.notConnected"), tone: "muted" };
  }
}

export function SavedBackendListRow({
  environment,
  removingEnvironmentId,
  onSetEnabled,
  onRemove,
  onAddRoute,
}: SavedBackendListRowProps) {
  const t = useT();
  const [routesOpen, setRoutesOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const environmentId = environment.environmentId;
  const unsupported = environment.connection.phase === "unsupported";
  const blocked = unsupported && !hasSavedBearerRoute(environment.entry);
  const enabled = environment.entry.enabled && !unsupported;
  const isConnected = environment.connection.phase === "connected";
  const isRemoving = removingEnvironmentId === environmentId;
  const errorTraceId = environment.connection.traceId;
  const { copyToClipboard: copyTraceIdToClipboard } = useCopyToClipboard<{ traceId: string }>({
    target: "trace ID",
    onCopy: ({ traceId }) => {
      toastManager.add({
        type: "success",
        title: t("settingsPages.connections.backend.traceCopied"),
        description: traceId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settingsPages.connections.backend.traceCopyFailed"),
          description: error.message,
        }),
      );
    },
  });
  const copyTraceId = (traceId: string) => {
    copyTraceIdToClipboard(traceId, { traceId });
  };
  const { copyToClipboard: copyMcpUrl } = useCopyToClipboard<{ url: string }>({
    target: "MCP URL",
    onCopy: ({ url }) => {
      toastManager.add({
        type: "success",
        title: t("settingsPages.connections.backend.mcpCopied"),
        description: t("settingsPages.connections.backend.mcpCopiedDescription", { url }),
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settingsPages.connections.backend.mcpCopyFailed"),
          description: error.message,
        }),
      );
    },
  });
  const versionMismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
  const serverUpdateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const resumingServerUpdate =
    serverUpdateState.status === "running" && serverUpdateState.stage === "resuming";
  const status = savedBackendStatus(environment);
  const serverVersion = environment.serverConfig?.environment.serverVersion ?? null;
  // Discovery empties its map on every refresh, so hold the last descriptor
  // seen or the glyph would blink back to the generic one each time.
  const relayDiscovery = useRelayEnvironmentDiscovery();
  const discoveredDescriptor = Option.getOrNull(
    relayDiscovery.environments.get(environmentId)?.status ?? Option.none(),
  )?.descriptor;
  const [lastDescriptor, setLastDescriptor] = useState(discoveredDescriptor);
  if (discoveredDescriptor !== undefined && discoveredDescriptor !== lastDescriptor) {
    setLastDescriptor(discoveredDescriptor);
  }
  const discoveredRelayHttpBaseUrl =
    relayDiscovery.environments.get(environmentId)?.environment.endpoint.httpBaseUrl;
  const [lastRelayHttpBaseUrl, setLastRelayHttpBaseUrl] = useState(discoveredRelayHttpBaseUrl);
  if (
    discoveredRelayHttpBaseUrl !== undefined &&
    discoveredRelayHttpBaseUrl !== lastRelayHttpBaseUrl
  ) {
    setLastRelayHttpBaseUrl(discoveredRelayHttpBaseUrl);
  }
  const retryNow = useAtomCommand(environmentCatalog.retryNow);
  const {
    diagnosis: currentDiagnosis,
    state: connectionState,
    relayOnly,
  } = useConnectionDiagnosis(environment);
  const diagnosis = resumingServerUpdate ? null : currentDiagnosis;
  const prepared = usePreparedConnection(environmentId);
  const connectedTarget = isConnected && prepared._tag === "Some" ? prepared.value.target : null;
  const mcpUrl = environmentMcpUrl({
    entry: environment.entry,
    relayHttpBaseUrl: discoveredRelayHttpBaseUrl ?? lastRelayHttpBaseUrl,
    connectedTarget,
  });
  const machineKind = resolveEnvironmentMachineKind(
    environment.serverConfig ??
      (lastDescriptor === undefined ? null : { environment: lastDescriptor }),
  );
  const routeCount = connectionRoutes(environment.entry).length;
  const subtitleText = [
    environmentTransportLabel(environment, connectedTarget),
    // The headline below names the failure in full.
    diagnosis
      ? null
      : resumingServerUpdate
        ? t("settingsPages.connections.backend.restarting")
        : status.text,
    enabled && versionMismatch ? serverVersion : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  const showUpdateAction =
    enabled &&
    isConnected &&
    versionMismatch !== null &&
    (serverUpdateState.status === "idle" || serverUpdateState.status === "failed");

  const statusTooltip = `${
    unsupported
      ? (environment.connection.error ?? connectionStatusText(environment.connection))
      : enabled
        ? connectionStatusText(environment.connection)
        : t("settingsPages.connections.backend.switchedOff")
  }${
    versionMismatch
      ? `\n${t("settingsPages.connections.backend.updateAvailable", {
          from: versionMismatch.serverVersion,
          to: versionMismatch.clientVersion,
        })}`
      : ""
  }`;

  return (
    <EnvironmentRow
      kind={machineKind}
      label={environment.label}
      dimmed={!enabled}
      subtitle={
        <span className="flex min-w-0 items-center gap-1">
          <Tooltip>
            {/* The status can change while the tooltip is open, and base-ui only
                re-measures the popup when the trigger's payload changes. */}
            <TooltipTrigger
              payload={statusTooltip}
              render={
                <span
                  className={cn(
                    "min-w-0 truncate",
                    enabled &&
                      status.tone === "error" &&
                      !resumingServerUpdate &&
                      !diagnosis &&
                      "text-destructive",
                  )}
                />
              }
            >
              {subtitleText}
            </TooltipTrigger>
            <TooltipPopup side="top" className="whitespace-pre-wrap">
              {statusTooltip}
            </TooltipPopup>
          </Tooltip>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <button
            type="button"
            aria-expanded={routesOpen}
            onClick={() => setRoutesOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {routeCount === 1
              ? t("settingsPages.connections.backend.routes")
              : t("settingsPages.connections.backend.routesCount", { count: routeCount })}
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                routesOpen && "rotate-90",
              )}
            />
          </button>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <button
            type="button"
            aria-expanded={permissionsOpen}
            aria-controls={`remote-permissions-${environmentId}`}
            onClick={() => setPermissionsOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {t("settingsPages.connections.backend.permissions")}
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                permissionsOpen && "rotate-90",
              )}
            />
          </button>
        </span>
      }
      below={
        <>
          {diagnosis ? (
            <ConnectionDiagnosisSummary
              diagnosis={diagnosis}
              retryAt={connectionState.phase === "backoff" ? connectionState.retryAt : null}
              attempt={connectionState.attempt}
              expanded={diagnosisOpen}
              onToggle={() => setDiagnosisOpen((open) => !open)}
            />
          ) : null}
          {serverUpdateState.status !== "idle" ? (
            <div className="mt-1 max-w-md">
              <ServerUpdateProgress state={serverUpdateState} />
            </div>
          ) : null}
        </>
      }
      detail={
        <>
          {diagnosis && diagnosisOpen ? (
            <ConnectionDiagnosisPanel
              hostLabel={environment.label}
              diagnosis={diagnosis}
              onRetry={() => void retryNow(environmentId)}
              onAddRoute={relayOnly ? () => onAddRoute(environment) : null}
            />
          ) : null}
          {routesOpen && (
            <EnvironmentRoutesList
              environment={environment}
              onAddRoute={() => onAddRoute(environment)}
            />
          )}
          {permissionsOpen && (
            <div
              id={`remote-permissions-${environmentId}`}
              className="mt-2 border-t border-border/50"
            >
              <SessionPermissions
                environmentId={environmentId}
                connected={isConnected}
                routeContext
              />
            </div>
          )}
        </>
      }
    >
      {unsupported &&
      environment.entry.serverUpdateRequired === true &&
      serverUpdateState.status !== "running" ? (
        <OutdatedServerUpdateAction
          environmentId={environmentId}
          serverLabel={t("settingsPages.connections.backend.serverLabel", {
            name: environment.label,
          })}
          fromVersion={lastDescriptor?.serverVersion}
          targetVersion={APP_VERSION}
          label={
            serverUpdateState.status === "failed"
              ? t("settingsPages.connections.backend.retryUpdate")
              : t("settingsPages.connections.backend.update")
          }
        />
      ) : null}
      {showUpdateAction ? (
        <ServerUpdateAction
          environmentId={environmentId}
          serverLabel={t("settingsPages.connections.backend.serverLabel", {
            name: environment.label,
          })}
          selfUpdate={resolveServerSelfUpdateCapability(environment.serverConfig)}
          installation={environment.serverConfig?.environment.capabilities.serverInstallation}
          desktopAppUpdate={supportsDesktopAppUpdate(environment.serverConfig)}
          targetVersion={versionMismatch.clientVersion}
          label={
            serverUpdateState.status === "failed"
              ? t("settingsPages.connections.backend.retryUpdate")
              : t("settingsPages.connections.backend.update")
          }
          appearance="icon"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Switch
              size="sm"
              checked={enabled}
              disabled={isRemoving || blocked}
              aria-label={t(
                enabled
                  ? "settingsPages.connections.backend.switchAriaLabel.off"
                  : "settingsPages.connections.backend.switchAriaLabel.on",
                { name: environment.label },
              )}
              onCheckedChange={(checked) => onSetEnabled(environmentId, checked)}
            />
          }
        />
        <TooltipPopup side="top">
          {blocked
            ? t("settingsPages.connections.backend.unsupported")
            : enabled
              ? t("settingsPages.connections.backend.switchOff")
              : t("settingsPages.connections.backend.switchOn")}
        </TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              disabled={isRemoving}
              aria-label={t("settingsPages.connections.backend.moreActions", {
                name: environment.label,
              })}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <EnvironmentIconMenu
            environmentId={environmentId}
            serverConfig={environment.serverConfig}
          />
          <MenuItem onClick={() => setRoutesOpen((open) => !open)}>
            <RouteIcon />
            {routesOpen
              ? t("settingsPages.connections.backend.hideRoutes")
              : t("settingsPages.connections.backend.routes")}
          </MenuItem>
          {mcpUrl ? (
            <MenuItem onClick={() => copyMcpUrl(mcpUrl, { url: mcpUrl })}>
              {t("settingsPages.connections.backend.copyMcp")}
            </MenuItem>
          ) : null}
          {errorTraceId ? (
            <MenuItem onClick={() => copyTraceId(errorTraceId)}>
              {t("settingsPages.connections.backend.copyTrace")}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => onRemove(environment)}>
            {isRemoving
              ? t("settingsPages.connections.backend.removing")
              : t("settingsPages.connections.backend.remove")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </EnvironmentRow>
  );
}

function CloudLinkSwitch({
  checked,
  disabled,
  disabledReason,
  onCheckedChange,
  ariaLabel,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onCheckedChange?: (enabled: boolean) => void;
  readonly ariaLabel?: string;
}) {
  const t = useT();
  const control = (
    <Switch
      aria-label={ariaLabel ?? t("settingsPages.connections.cloud.enableAriaLabel")}
      checked={checked}
      disabled={disabled}
      {...(onCheckedChange ? { onCheckedChange } : {})}
    />
  );
  return disabledReason ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{control}</span>} />
      <TooltipPopup side="top">{disabledReason}</TooltipPopup>
    </Tooltip>
  ) : (
    control
  );
}

/** Tunnel meter, plus the upgrade prompt after the relay refuses a tunnel at the cap. */
function T3ConnectTunnelUsage({ tunnelLimit }: { readonly tunnelLimit: number | null }) {
  const usage = useManagedTunnelUsage();
  const accountPage = useT3ConnectAccountPage();
  const openAccountPage = accountPage.open;
  // Usage when the relay refused. The relay also counts tunnels still being set up, so only
  // a freed tunnel or a higher cap clears the alert, not a meter that merely shows room.
  const [usedAtRefusal, setUsedAtRefusal] = useState<number | null>(null);
  if (tunnelLimit === null) {
    if (usedAtRefusal !== null) setUsedAtRefusal(null);
  } else if (usedAtRefusal === null && usage.used !== null) {
    setUsedAtRefusal(usage.used);
  }
  const showLimitAlert =
    tunnelLimit !== null &&
    !(usedAtRefusal !== null && usage.used !== null && usage.used < usedAtRefusal) &&
    !(usage.limit !== null && usage.limit > tunnelLimit);
  const meter =
    usage.used !== null && usage.limit !== null ? (
      <TunnelUsageMeter
        used={usage.used}
        limit={usage.limit}
        action={
          // At the cap the alert below carries the same action.
          usage.upgrade && openAccountPage && !showLimitAlert ? (
            <InlineButton onClick={() => openAccountPage("t3-chat")}>Get more tunnels</InlineButton>
          ) : null
        }
      />
    ) : null;
  return (
    <>
      {meter || showLimitAlert ? (
        <div className="flex flex-col gap-3 pb-3">
          {meter}
          {showLimitAlert ? (
            <TunnelLimitAlert
              upgrade={usage.upgrade}
              onLinkT3Chat={openAccountPage ? () => openAccountPage("t3-chat") : null}
              onManageTunnels={openAccountPage ? () => openAccountPage("t3-connect") : null}
            />
          ) : null}
        </div>
      ) : null}
      {/* Kept outside the conditional so an open account page does not remount. */}
      {accountPage.portals}
    </>
  );
}

function ConfiguredCloudLinkRow({ canManageRelay }: { readonly canManageRelay: boolean }) {
  const t = useT();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const {
    isSignedIn,
    linkState: primaryCloudLinkState,
    linkRevoked,
    managedTunnelActive,
    managedTunnelOutOfSync,
    publishAgentActivity,
    holdWebhooksWhileOffline,
    operationError,
    tunnelLimit,
    reconcileCloudState,
  } = useCloudLinkController();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);

  const disabledReason = canManageRelay ? null : t("settingsPages.connections.cloud.noPermission");
  const isBusy = isUpdating || isUpdatingPreference;
  const switchDisabled =
    !canManageRelay ||
    !isSignedIn ||
    primaryCloudLinkState.data === null ||
    primaryCloudLinkState.isPending ||
    isBusy;
  // `isSignedIn` is undefined until Clerk loads. Signed out, one row shows a
  // sign-in button instead of its switch; the onboarding dialog that opens after
  // a fresh sign-in offers both linking and publishing.
  const signedOut = isSignedIn === false;
  const signInButton = (
    <Button size="sm" variant="outline" onClick={openAuthPrompt}>
      {t("onboarding.signIn")}
    </Button>
  );
  const refreshLinkState = useEffectEvent(primaryCloudLinkState.refresh);
  // The server rechecks reachability when the tunnel's 30 s readiness poll changes.
  // Poll while mounted, so a failed read does not stop later ones.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- 30 s interval that refreshes the cloud link reachability while mounted
  useEffect(() => {
    const interval = window.setInterval(() => refreshLinkState(), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const reachability = managedTunnelActive ? primaryCloudLinkState.data?.reachability : undefined;
  const reachabilityStatus =
    reachability?.status === "reachable" ? (
      formatConnectReachable(reachability)
    ) : reachability?.status === "unreachable" ? (
      <span className="block text-destructive">
        {[
          reachability.reason,
          reachability.hint,
          t("settingsPages.connections.cloud.fix", { fix: reachability.fix }),
        ]
          .filter(Boolean)
          .join(" ")}{" "}
        <a
          href={connectReachabilityHelpUrl(reachability.cause)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t("settingsPages.connections.cloud.moreInfo")}
        </a>
      </span>
    ) : null;

  const updateManagedTunnel = async (enabled: boolean) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthRelayWriteScope)
    )
      return;
    setIsUpdating(true);
    const ok = await reconcileCloudState({ managedTunnel: enabled, publish: publishAgentActivity });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settingsPages.connections.cloud.linked")
          : publishAgentActivity
            ? t("settingsPages.connections.cloud.tunnelDisabled")
            : t("settingsPages.connections.cloud.unlinked"),
        description: enabled
          ? t("settingsPages.connections.cloud.linkedDescription")
          : publishAgentActivity
            ? t("settingsPages.connections.cloud.tunnelDisabledDescription")
            : t("settingsPages.connections.cloud.unlinkedDescription"),
      });
    }
    setIsUpdating(false);
  };

  const updatePublishAgentActivity = async (enabled: boolean) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthRelayWriteScope)
    )
      return;
    setIsUpdatingPreference(true);
    const ok = await reconcileCloudState({ managedTunnel: managedTunnelActive, publish: enabled });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settingsPages.connections.cloud.activityEnabled")
          : t("settingsPages.connections.cloud.activityDisabled"),
        description: enabled
          ? t("settingsPages.connections.cloud.activityEnabledDescription")
          : t("settingsPages.connections.cloud.activityDisabledDescription"),
      });
    }
    setIsUpdatingPreference(false);
  };

  const updateHoldWebhooks = async (enabled: boolean) => {
    setIsUpdatingPreference(true);
    const ok = await reconcileCloudState({
      managedTunnel: managedTunnelActive,
      publish: publishAgentActivity,
      holdWebhooksWhileOffline: enabled,
    });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? t("settingsPages.connections.cloud.webhooksHeld")
          : t("settingsPages.connections.cloud.webhooksNotHeld"),
        description: enabled
          ? t("settingsPages.connections.cloud.webhooksHeldDescription")
          : t("settingsPages.connections.cloud.webhooksNotHeldDescription"),
      });
    }
    setIsUpdatingPreference(false);
  };

  return (
    <>
      {isElectron ? (
        <SettingsRow
          title={t("settingsPages.connections.cloud.title")}
          description={
            signedOut
              ? "Sign in to make this environment available to your other devices through T3 Connect."
              : linkRevoked
                ? t("settingsPages.connections.cloud.revoked")
                : managedTunnelActive
                  ? reachability?.status === "unreachable"
                    ? t("settingsPages.connections.cloud.unreachable")
                    : reachability?.status === "reachable"
                      ? t("settingsPages.connections.cloud.reachable")
                      : t("settingsPages.connections.cloud.unchecked")
                  : managedTunnelOutOfSync
                    ? t("settingsPages.connections.cloud.outOfSync")
                    : t("settingsPages.connections.cloud.offDescription")
          }
          status={operationError ?? primaryCloudLinkState.error ?? reachabilityStatus}
          control={
            signedOut ? (
              signInButton
            ) : (
              <CloudLinkSwitch
                checked={managedTunnelActive}
                disabled={switchDisabled}
                disabledReason={disabledReason}
                onCheckedChange={(enabled) => void updateManagedTunnel(enabled)}
              />
            )
          }
        >
          {signedOut ? null : <T3ConnectTunnelUsage tunnelLimit={tunnelLimit} />}
        </SettingsRow>
      ) : linkRevoked ? (
        <SettingsRow
          title={t("settingsPages.connections.cloud.title")}
          description={t("settingsPages.connections.cloud.revokedHeadless")}
        />
      ) : null}
      {signedOut && isElectron ? null : (
        <SettingsRow
          title={t("settingsPages.connections.cloud.publish.title")}
          description={
            signedOut
              ? "Sign in to send activity to mobile notifications and Live Activities."
              : t("settingsPages.connections.cloud.publish.description")
          }
          control={
            signedOut ? (
              signInButton
            ) : (
              <CloudLinkSwitch
                ariaLabel={t("settingsPages.connections.cloud.publish.ariaLabel")}
                checked={publishAgentActivity}
                disabled={switchDisabled}
                disabledReason={disabledReason}
                onCheckedChange={(enabled) => void updatePublishAgentActivity(enabled)}
              />
            )
          }
        />
      )}
      {managedTunnelActive && !signedOut ? (
        <SettingsRow
          title={t("settingsPages.connections.cloud.hold.title")}
          description={t("settingsPages.connections.cloud.hold.description")}
          control={
            <CloudLinkSwitch
              ariaLabel={t("settingsPages.connections.cloud.hold.ariaLabel")}
              checked={holdWebhooksWhileOffline}
              disabled={switchDisabled}
              disabledReason={disabledReason}
              onCheckedChange={(enabled) => void updateHoldWebhooks(enabled)}
            />
          }
        />
      ) : null}
    </>
  );
}

export function CloudLinkRow({
  canReadRelay,
  canManageRelay,
}: {
  readonly canReadRelay: boolean;
  readonly canManageRelay: boolean;
}) {
  const t = useT();
  if (!hasCloudPublicConfig()) return null;
  if (!canReadRelay) {
    return (
      <SettingsRow
        title={t("settingsPages.connections.cloud.title")}
        description={t("settingsPages.connections.cloud.needsPermissions")}
      />
    );
  }
  return <ConfiguredCloudLinkRow canManageRelay={canManageRelay} />;
}

function EmptyRemoteEnvironments({ cloudEnabled = true }: { readonly cloudEnabled?: boolean }) {
  const t = useT();
  return (
    <Empty className="min-h-52">
      <EmptyMedia variant="icon">
        <ChevronsLeftRightEllipsisIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{t("settingsPages.connections.remote.emptyTitle")}</EmptyTitle>
        <EmptyDescription>
          {cloudEnabled
            ? t("settingsPages.connections.remote.emptyCloud")
            : t("settingsPages.connections.remote.empty")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CloudRemoteEnvironmentRows({
  primaryEnvironmentId,
  savedEnvironments,
}: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironments: ReadonlyArray<EnvironmentPresentation>;
}) {
  return hasCloudPublicConfig() ? (
    <CloudEnvironmentConnectRows
      primaryEnvironmentId={primaryEnvironmentId}
      savedEnvironments={savedEnvironments}
      empty={<EmptyRemoteEnvironments />}
    />
  ) : savedEnvironments.length === 0 ? (
    <EmptyRemoteEnvironments cloudEnabled={false} />
  ) : null;
}
