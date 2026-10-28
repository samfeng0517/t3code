import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  makeProviderSettingsSchema,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import * as Schema from "effect/Schema";

import type { Translate } from "~/i18n";
import { formatMessage } from "~/i18n/locale";
import { en } from "~/i18n/messages/en";
import { zhTW } from "~/i18n/messages/zh-TW";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutomationSearchAvailability,
  isSettingsSearchScopeAvailable,
  movedSettingsPath,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  settingsSearchItemTitle,
  sourceControlHostSearchItems,
  sourceControlHostSettingsSearchId,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/access",
    searchTerms: ["remote pairing backend"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("sharing", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual(["setting-glass-opacity"]);
    expect(searchSettings("panel animations").map((item) => item.id)).toEqual(["panel-animations"]);
    expect(searchSettings("thè\u{1ab0}mes")[0]?.id).toBe("theme");
    const localeLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase").mockReturnValue("gıt");
    try {
      expect(searchSettings("GIT")[0]?.id).toBe("git-fetch-interval");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("pairing remote", ITEMS).map((item) => item.id)).toEqual([
      "network-access",
    ]);
    expect(
      searchSettings("remote pairing")
        .slice(0, 2)
        .map((item) => item.id),
    ).toEqual(["network-access", "connections-environment"]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
    expect(searchSettings("update track")).toEqual([]);
  });

  it("hides settings whose controls are unavailable", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
      hasThreadAutoCleanup: false,
    });

    const gatedIds = new Set<string>([
      "follow-change-request-templates",
      "git-fetch-interval",
      "network-access",
      "publish-agent-activity",
      "provider-health-check-interval",
      "cursor-keychain-usage",
      "source-control-writer-model",
      "review-guide-model",
      "review-guide-instructions",
      "source-control-writing-style",
      "t3-connect",
      "hold-webhooks-while-offline",
      "tailscale-https",
      "wsl-backend",
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "linked-environments",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("finds linked environments on a remote host without local maintenance access", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      localEnvironmentDisabled: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
      hasThreadAutoCleanup: false,
    };
    const results = (hasPeerLinkHost: boolean) =>
      searchSettings(
        "linked environments",
        filterAvailableSettingsSearchItems({ ...availability, hasPeerLinkHost }),
      );
    expect(results(false).map((item) => item.id)).not.toContain("linked-environments");
    expect(results(true)).toContainEqual(
      expect.objectContaining({
        id: "linked-environments",
        to: "/settings/connections",
        targetId: "linked-environments",
      }),
    );
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("thread.stop")[0]).toMatchObject({
      id: "keybinding-thread.stop",
      targetId: "keybindings",
    });
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("start-from-origin search removal", () => {
  it("settings search should not offer start-from-origin when searching for remote", () => {
    expect(SETTINGS_SEARCH_ITEMS.map((item) => item.id)).not.toContain("start-from-origin");
    expect(searchSettings("start from remote").map((item) => item.id)).not.toContain(
      "start-from-origin",
    );
  });
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const streaming = getSettingsSearchTargetScope("response-streaming")!;
    expect(streaming.scope).toBe("project-defaults");
    expect(isSettingsSearchScopeAvailable(streaming.scope, "project")).toBe(true);
    for (const id of ["legacy-plan-mode", "legacy-context-window-indicator", "legacy-sidebar"]) {
      expect(getSettingsSearchTargetScope(id)!.scope).toBeNull();
    }
  });
});

describe("auto-settlement search availability", () => {
  function environment(id: string, { connected = true, loaded = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded ? { environment: { capabilities: {} } } : null,
    };
  }

  const capable = environment("capable");
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, offline, loading];

  it("keeps results discoverable when one connected environment supports them", () => {
    const availability = getThreadAutomationSearchAvailability(
      "threadAutoSettlement",
      environments,
    );
    expect(availability.eligibleEnvironmentIds).toEqual([capable.environmentId]);
    const items = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: availability.eligibleEnvironmentIds.length > 0,
      hasThreadAutoCleanup: false,
    });
    expect(searchSettings("auto-settle", items).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "keep-threads-with-pull-requests",
    ]);
  });

  it.each([offline, loading])(
    "does not render the target on $environmentId or silently fall back",
    (selected) => {
      expect(
        getThreadAutomationSearchAvailability("threadAutoSettlement", environments, {
          kind: "environment",
          environmentIds: [selected.environmentId],
        }),
      ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
    },
  );

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutomationSearchAvailability("threadAutoSettlement", selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });
});

describe("auto-cleanup search availability", () => {
  const settleOnly = {
    environmentId: EnvironmentId.make("settle-only"),
    connection: { phase: "connected" as const },
    serverConfig: { environment: { capabilities: {} } },
  };
  const cleanup = {
    environmentId: EnvironmentId.make("cleanup"),
    connection: { phase: "connected" as const },
    serverConfig: {
      environment: { capabilities: { threadAutoCleanup: true } },
    },
  };
  const searchCleanup = (hasThreadAutoCleanup: boolean) =>
    searchSettings(
      "auto-archive",
      filterAvailableSettingsSearchItems({
        hasCloudPublicConfig: false,
        hasEnvironment: true,
        hasProviderSettingsEnvironment: true,
        hasMacProviderSettingsEnvironment: false,
        canManageLocalBackend: false,
        isWslSettingsRowVisible: false,
        hasThreadAutoSettlement: true,
        hasThreadAutoCleanup,
      }),
    ).map((item) => item.id);

  it("should hide cleanup results when no connected environment supports thread auto cleanup", () => {
    expect(searchCleanup(false)).not.toContain("auto-archive-settled-threads");
    expect(searchCleanup(true)).toContain("auto-archive-settled-threads");
  });

  it("should mark cleanup targets as requiring thread auto cleanup when resolving a search target", () => {
    for (const id of ["auto-archive-settled-threads", "auto-delete-archived-threads"]) {
      expect(getSettingsSearchTargetScope(id)).toMatchObject({ requiresThreadAutoCleanup: true });
    }
  });

  it("should offer only cleanup-capable environments when an aggregate mixes server versions", () => {
    const environments = [settleOnly, cleanup];
    expect(
      getThreadAutomationSearchAvailability("threadAutoCleanup", environments, {
        kind: "all",
        environmentIds: environments.map((entry) => entry.environmentId),
      }),
    ).toEqual({ eligibleEnvironmentIds: [cleanup.environmentId], isTargetAvailable: false });
  });
});

describe("localized settings search", () => {
  const translateEn: Translate = (key, params) => formatMessage(en[key], params);
  const translateZhTW: Translate = (key, params) => formatMessage(zhTW[key], params);
  const searchZhTW = (query: string) =>
    searchSettings(query, SETTINGS_SEARCH_ITEMS, { translate: translateZhTW }).map(
      (item) => item.id,
    );

  it("has an English search index message matching every item title", () => {
    const keyOf: Translate = (key) => `<${key}>`;
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(settingsSearchItemTitle(item, keyOf), item.id).not.toBe(item.title);
      expect(settingsSearchItemTitle(item, translateEn), item.id).toBe(item.title);
    }
  });

  it("matches Chinese titles, sections, and search terms", () => {
    expect(searchZhTW("顯示語言")[0]).toBe("language");
    expect(searchZhTW("語言")).toContain("language");
    expect(searchZhTW("對比")[0]).toBe("setting-appearance-contrast");
    expect(searchZhTW("深色")).toContain("color-scheme");
    expect(searchZhTW("外觀 字型")).toEqual(
      expect.arrayContaining(["interface-font", "code-font", "terminal-font"]),
    );
    expect(searchZhTW("終端機 切換")).toContain("keybinding-terminal.toggle");

    const appearanceIds = SETTINGS_SEARCH_ITEMS.filter(
      (item) => item.to === "/settings/appearance" && !("macOnly" in item),
    ).map((item) => item.id);
    expect(searchZhTW("外觀")).toEqual(expect.arrayContaining(appearanceIds));
  });

  it("keeps English queries working alongside the translation", () => {
    expect(searchZhTW("contrast")[0]).toBe("setting-appearance-contrast");
    expect(searchZhTW("appearance")).toContain("word-wrap");
    expect(searchSettings("對比").map((item) => item.id)).toEqual([]);
  });

  it("ranks localized title matches above section matches", () => {
    const results = searchZhTW("外觀");
    expect(results[0]).toBe("browser-default-appearance");
    expect(results).toContain("word-wrap");
  });

  it("localizes generated source control host titles", () => {
    const hosts = SETTINGS_SEARCH_ITEMS.filter((item) =>
      item.id.startsWith("source-control-host-"),
    );
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(settingsSearchItemTitle(host, translateZhTW)).toBe(
        host.title.replace(/ credentials$/, " 憑證").replace(/ accounts and token$/, " 帳號與權杖"),
      );
    }
  });
});

describe("source control host search items", () => {
  const definition = {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("example"),
    label: "Example",
    searchKeywords: ["sample"],
    settings: makeProviderSettingsSchema({ apiToken: Schema.String }),
  };

  it("lists a host by its label, its keywords, and its settings fields", () => {
    const items = sourceControlHostSearchItems([UNKNOWN_SOURCE_CONTROL_CLIENT, definition]);
    expect(items.map((item) => item.title)).toEqual(["Example credentials"]);
    expect(searchSettings("sample apitoken", items).map((item) => item.id)).toEqual([
      sourceControlHostSettingsSearchId("example"),
    ]);
  });

  it("lists a host with credentials by its accounts, token and CLI", () => {
    const items = sourceControlHostSearchItems([
      {
        ...definition,
        credentials: {
          cliName: "ex",
          cliLabel: "Example CLI",
          loginCommand: "ex login",
          tokenEnvVar: "EX_TOKEN",
          tokenAccess: "access",
          newTokenUrl: (host) => `https://${host}/tokens`,
        },
      },
    ]);
    expect(items.map((item) => item.title)).toEqual(["Example accounts and token"]);
    expect(searchSettings("ex switch accounts", items)).toHaveLength(1);
  });

  it("finds the built-in hosts by their own words", () => {
    expect(searchSettings("codeberg").map((item) => item.id)).toContain("source-control");
    expect(searchSettings("ghes").map((item) => item.id)).toContain(
      sourceControlHostSettingsSearchId("github"),
    );
  });
});

describe("movedSettingsPath", () => {
  it("sends old links to the page their row moved to", () => {
    expect(movedSettingsPath("/settings/general", "text-generation-model")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/connections", "authorized-clients")).toBe(
      "/settings/access",
    );
    expect(movedSettingsPath("/settings/source-control", "worktree-branch-naming")).toBe(
      "/settings/worktrees",
    );
    expect(movedSettingsPath("/settings/appearance", "diff-color-scheme")).toBe("/settings/diffs");
    expect(movedSettingsPath("/settings/connections", "network-access")).toBe("/settings/access");
    expect(movedSettingsPath("/settings/storage", "storage-worktrees")).toBe("/settings/worktrees");
    expect(movedSettingsPath("/settings/storage", "")).toBe("/settings/maintenance");
    expect(movedSettingsPath("/settings/integrations", "devices")).toBe("/settings/devices");
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/labs");
  });

  it("leaves current pages alone", () => {
    expect(movedSettingsPath("/settings/general", "time-format")).toBeNull();
    expect(movedSettingsPath("/settings/projects", "project-defaults")).toBeNull();
    expect(movedSettingsPath("/settings/connections", "remote-environments")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "theme")).toBeNull();
  });
});
