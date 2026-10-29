import type {
  ServerProvider,
  ServerProviderVersionAdvisory,
  ServerProviderCompatibilityAdvisory,
} from "@t3tools/contracts";

import { t as globalT, type MessageKey, type Translate } from "~/i18n";

export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  neutral: {
    dot: "bg-muted-foreground",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

// Antigravity's local health check verifies installation, not Google sign-in.
// API-key and Agent Platform warnings still need attention.
function isAntigravitySignInUnchecked(provider: ServerProvider): boolean {
  return (
    provider.driver === "antigravity" &&
    provider.installed &&
    provider.status === "warning" &&
    provider.auth.status === "unknown" &&
    (provider.auth.type === undefined ||
      provider.auth.type === "oauth-personal" ||
      provider.auth.type === "oauth-business")
  );
}

export function getProviderStatusKey(provider: ServerProvider | undefined): ProviderStatusKey {
  // An instance the server could not start reports `enabled: false` even when the user enabled it.
  if (provider?.availability === "unavailable") return "error";
  if (provider && !provider.enabled) return "disabled";
  if (provider && isAntigravitySignInUnchecked(provider)) return "neutral";
  return provider?.status ?? "warning";
}

export function getProviderSummary(provider: ServerProvider | undefined, t: Translate = globalT) {
  if (!provider) {
    return {
      headline: t("providerSetup.status.checking.headline"),
      detail: t("providerSetup.status.checking.detail"),
    };
  }
  if (provider.availability === "unavailable") {
    return {
      headline: t("providerSetup.status.unavailable"),
      detail:
        provider.unavailableReason ??
        provider.message ??
        t("providerSetup.status.unavailable.detail"),
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: t("providerSetup.status.disabled"),
      detail: provider.message ?? t("providerSetup.status.disabled.detail"),
    };
  }
  if (!provider.installed) {
    return {
      headline: t("providerSetup.status.notFound"),
      detail: provider.message ?? t("providerSetup.status.notFound.detail"),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? t("providerSetup.status.unauthenticatedWithLabel", { label: authLabel })
        : t("providerSetup.status.unauthenticated"),
      detail: provider.message ?? null,
    };
  }
  if (isAntigravitySignInUnchecked(provider)) {
    return {
      headline: t("providerSetup.status.signInUnchecked"),
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: t("providerSetup.status.warning"),
      detail: provider.message ?? t("providerSetup.status.warning.detail"),
    };
  }
  if (provider.status === "error") {
    return {
      headline: t("providerSetup.status.unavailable"),
      detail: provider.message ?? t("providerSetup.status.error.detail"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? t("providerSetup.status.authenticatedWithLabel", { label: authLabel })
        : t("providerSetup.status.authenticated"),
      detail: provider.message ?? null,
    };
  }
  return {
    headline: t("providerSetup.status.available"),
    detail: provider.message ?? null,
  };
}

export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLES = {
  graceful: "providerSetup.status.compat.graceful",
  unsupported: "providerSetup.status.compat.unsupported",
  broken: "providerSetup.status.compat.broken",
} as const satisfies Record<string, MessageKey>;

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  compatibility?: ServerProviderCompatibilityAdvisory | undefined,
  showCompatibility = true,
  t: Translate = globalT,
): {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
} | null {
  const latestIsIncompatible =
    compatibility?.latestVersionStatus === "broken" ||
    compatibility?.latestVersionStatus === "unsupported";
  if (
    showCompatibility &&
    compatibility &&
    (compatibility.status === "graceful" ||
      compatibility.status === "unsupported" ||
      compatibility.status === "broken")
  ) {
    const targetVersion = compatibility.recommendedVersion;
    const recommendation = getProviderVersionLabel(targetVersion) ?? compatibility.recommendedRange;
    // Latest package versions cannot be updated into recommendations requiring another package.
    const isAlreadyLatest = advisory?.status === "current";
    return {
      title: t(COMPATIBILITY_TITLES[compatibility.status]),
      detail:
        compatibility.message ??
        (recommendation
          ? t("providerSetup.status.compat.useVersion", { version: recommendation })
          : t("providerSetup.status.compat.update")),
      updateCommand:
        targetVersion || latestIsIncompatible || isAlreadyLatest
          ? null
          : (advisory?.updateCommand ?? null),
      emphasis: compatibility.status === "graceful" ? "normal" : "strong",
      targetVersion,
    };
  }
  if (
    !advisory ||
    advisory.status === "current" ||
    advisory.status === "unknown" ||
    latestIsIncompatible
  ) {
    return null;
  }

  const label = t("providerSetup.status.updateAvailable");
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    title: label,
    detail:
      advisory.message ??
      (versionLabel
        ? t("providerSetup.status.installVersion", { label, version: versionLabel })
        : t("providerSetup.status.installLatest", { label })),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
    targetVersion: null,
  };
}
