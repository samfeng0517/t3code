import type { MessageKey } from "../en";
import { commandPaletteZhTW } from "./commandPalette";
import { commonZhTW } from "./common";
import { composerZhTW } from "./composer";
import { settingsZhTW } from "./settings";
import { sidebarZhTW } from "./sidebar";
import { settingsProvidersZhTW } from "./settingsProviders";
import { settingsPagesZhTW } from "./settingsPages";
import { workspaceZhTW } from "./workspace";
import { onboardingZhTW } from "./onboarding";
import { searchIndexZhTW } from "./searchIndex";
import { modsZhTW } from "./mods";
import { browserZhTW } from "./browser";
import { pageCommentsZhTW } from "./pageComments";
import { gitZhTW } from "./git";
import { branchToolbarZhTW } from "./branchToolbar";
import { gitActionsZhTW } from "./gitActions";
import { threadDetailsZhTW } from "./threadDetails";
import { shellZhTW } from "./shell";
import { chatViewZhTW } from "./chatView";
import { timelineZhTW } from "./timeline";
import { usageZhTW } from "./usage";
import { pullRequestsZhTW } from "./pullRequests";
import { pullRequestDetailZhTW } from "./pullRequestDetail";
import { providerSetupZhTW } from "./providerSetup";
import { settingsMiscZhTW } from "./settingsMisc";
import { deviceZhTW } from "./device";
import { filesZhTW } from "./files";
import { legacySidebarZhTW } from "./legacySidebar";

export const zhTW: Readonly<Record<MessageKey, string>> = {
  ...commonZhTW,
  ...settingsZhTW,
  ...sidebarZhTW,
  ...composerZhTW,
  ...commandPaletteZhTW,
  ...settingsProvidersZhTW,
  ...settingsPagesZhTW,
  ...workspaceZhTW,
  ...onboardingZhTW,
  ...searchIndexZhTW,
  ...modsZhTW,
  ...browserZhTW,
  ...pageCommentsZhTW,
  ...gitZhTW,
  ...branchToolbarZhTW,
  ...gitActionsZhTW,
  ...threadDetailsZhTW,
  ...shellZhTW,
  ...chatViewZhTW,
  ...timelineZhTW,
  ...usageZhTW,
  ...pullRequestsZhTW,
  ...pullRequestDetailZhTW,
  ...providerSetupZhTW,
  ...settingsMiscZhTW,
  ...deviceZhTW,
  ...filesZhTW,
  ...legacySidebarZhTW,
};
