import { PuzzleIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useT } from "~/i18n";

import {
  browserExtensionsBridge,
  refreshBrowserExtensions,
  updateBrowserExtensionsFromSources,
  useBrowserExtensionsStore,
} from "./browserExtensionsStore";

// Browsers check for extension updates every few hours, so a few minutes' lag is invisible.
const AUTO_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

/** Keeps copied extensions in step with their browsers while the desktop app runs. */
export function startBrowserExtensionsAutoUpdate(): void {
  if (!browserExtensionsBridge) return;
  void refreshBrowserExtensions().then(() => updateBrowserExtensionsFromSources(false));
  window.setInterval(() => void updateBrowserExtensionsFromSources(false), AUTO_UPDATE_INTERVAL_MS);
}

/** Shown once any extension was copied from another browser. */
export function BrowserExtensionsUpdateButton() {
  const t = useT();
  const hasCopies = useBrowserExtensionsStore((state) =>
    state.extensions.some((extension) => extension.source !== undefined),
  );
  const updating = useBrowserExtensionsStore((state) => state.updating);
  if (!hasCopies) return null;
  const label = t("browser.extensions.update.button");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={label}
            disabled={updating}
            onClick={() => void updateBrowserExtensionsFromSources(true)}
          />
        }
      >
        <PuzzleIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
