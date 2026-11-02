import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { BotIcon, type LucideIcon } from "lucide-react";
import { t } from "~/i18n";
import { cn } from "../../lib/utils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export function threadRelationshipStatusLabel(status: string | null): string {
  switch (status) {
    case "preparing":
    case "starting":
      return t("threadDetails.status.starting");
    case "running":
    case "in_progress":
      return t("threadDetails.status.running");
    case "pending":
    case "queued":
      return t("threadDetails.status.queued");
    case "waiting":
    case "blocked":
      return t("threadDetails.status.waiting");
    case "completed":
      return t("threadDetails.status.done");
    case "failed":
    case "error":
      return t("threadDetails.status.failed");
    case "cancelled":
    case "interrupted":
      return t("threadDetails.status.stopped");
    case "rolled_back":
      return t("threadDetails.status.reverted");
    case "resolved_native":
      return t("threadDetails.status.resolvedNative");
    case "resolved_portable":
      return t("threadDetails.status.resolvedPortable");
    case "consumed":
      return t("threadDetails.status.consumed");
    case "superseded":
      return t("threadDetails.status.superseded");
    case "idle":
      return t("threadDetails.status.idle");
    default:
      return t("threadDetails.status.unknown");
  }
}

export function ThreadRelationshipIcon({
  driver,
  provider,
  providerEntries = [],
  status,
  fallbackIcon: FallbackIcon = BotIcon,
}: {
  driver?: ProviderDriverKind | undefined;
  provider?: ServerProvider | undefined;
  providerEntries?: ReadonlyArray<ProviderInstanceEntry>;
  status: string | null;
  fallbackIcon?: LucideIcon;
}) {
  const iconClassName = "size-4 shrink-0 text-muted-foreground";
  const entry = driver
    ? providerEntries.find((candidate) => candidate.instanceId === provider?.instanceId)
    : undefined;
  const showInstanceBadge = entry !== undefined && shouldShowInstanceBadge(entry, providerEntries);
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      {driver ? (
        <ProviderInstanceIcon
          driverKind={driver}
          displayName={entry?.displayName ?? provider?.displayName ?? driver}
          accentColor={entry?.accentColor}
          acpRegistryAgentId={entry?.acpRegistryAgentId}
          acpRegistryIconUrl={entry?.acpRegistryIconUrl ?? provider?.iconUrl}
          showBadge={showInstanceBadge}
          size="compact"
          iconClassName={iconClassName}
          className="z-auto"
        />
      ) : (
        <FallbackIcon className={iconClassName} />
      )}
      <span
        className={cn(
          "absolute size-2 rounded-full border-2 border-card",
          showInstanceBadge ? "-left-1 -top-1" : "-bottom-1 -right-1",
          status === "running" ||
            status === "in_progress" ||
            status === "pending" ||
            status === "waiting"
            ? "bg-info"
            : status === "failed" || status === "error"
              ? "bg-destructive"
              : status === "completed"
                ? "bg-success"
                : "bg-muted-foreground/45",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
