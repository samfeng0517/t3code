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
} as const;

export type MessageKey = keyof typeof en;
