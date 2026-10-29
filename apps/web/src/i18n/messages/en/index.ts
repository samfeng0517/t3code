import { commandPaletteEn } from "./commandPalette";
import { commonEn } from "./common";
import { composerEn } from "./composer";
import { settingsEn } from "./settings";
import { sidebarEn } from "./sidebar";
import { settingsProvidersEn } from "./settingsProviders";
import { settingsPagesEn } from "./settingsPages";
import { workspaceEn } from "./workspace";
import { onboardingEn } from "./onboarding";
import { searchIndexEn } from "./searchIndex";
import { modsEn } from "./mods";
import { browserEn } from "./browser";
import { pageCommentsEn } from "./pageComments";
import { gitEn } from "./git";
import { branchToolbarEn } from "./branchToolbar";
import { gitActionsEn } from "./gitActions";
import { threadDetailsEn } from "./threadDetails";
import { shellEn } from "./shell";
import { chatViewEn } from "./chatView";
import { timelineEn } from "./timeline";
import { usageEn } from "./usage";
import { pullRequestsEn } from "./pullRequests";
import { pullRequestDetailEn } from "./pullRequestDetail";
import { providerSetupEn } from "./providerSetup";
import { settingsMiscEn } from "./settingsMisc";
import { deviceEn } from "./device";
import { filesEn } from "./files";
import { legacySidebarEn } from "./legacySidebar";

// English is the source of truth: every other locale is typed against these keys.
export const en = {
  ...commonEn,
  ...settingsEn,
  ...sidebarEn,
  ...composerEn,
  ...commandPaletteEn,
  ...settingsProvidersEn,
  ...settingsPagesEn,
  ...workspaceEn,
  ...onboardingEn,
  ...searchIndexEn,
  ...modsEn,
  ...browserEn,
  ...pageCommentsEn,
  ...gitEn,
  ...branchToolbarEn,
  ...gitActionsEn,
  ...threadDetailsEn,
  ...shellEn,
  ...chatViewEn,
  ...timelineEn,
  ...usageEn,
  ...pullRequestsEn,
  ...pullRequestDetailEn,
  ...providerSetupEn,
  ...settingsMiscEn,
  ...deviceEn,
  ...filesEn,
  ...legacySidebarEn,
} as const;

export type MessageKey = keyof typeof en;
