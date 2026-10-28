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
};
