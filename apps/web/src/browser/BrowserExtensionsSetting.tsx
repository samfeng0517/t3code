import type { BrowserExtensionMutationResult } from "@t3tools/contracts";
import { CopyPlusIcon, Plus as PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import {
  browserExtensionMutationToast,
  browserExtensionName,
  browserExtensionProblemText,
} from "./browserExtensions.logic";
import { BrowserExtensionImportDialog } from "./BrowserExtensionImportDialog";
import {
  browserExtensionsBridge as extensionsBridge,
  refreshBrowserExtensions,
  setBrowserExtensions as setExtensions,
  useBrowserExtensionsStore,
} from "./browserExtensionsStore";

export function BrowserExtensionsSetting({ disabled }: { readonly disabled: boolean }) {
  const t = useT();
  const extensions = useBrowserExtensionsStore((state) => state.extensions);
  const [pending, setPending] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // oxlint-disable-next-line t3code/react-effect-budget -- loads the extension list from the desktop bridge on mount, an external fetch
  useEffect(() => {
    void refreshBrowserExtensions();
  }, []);

  const mutate = async (path: string, run: () => Promise<BrowserExtensionMutationResult>) => {
    setPending(true);
    try {
      const result = await run();
      setExtensions(result.extensions);
      const toast = browserExtensionMutationToast(result, path, t);
      if (toast) toastManager.add(toast);
    } catch (error) {
      // Re-enable the controls before the toast so a throwing toast cannot leave them stuck.
      setPending(false);
      toastManager.add({
        type: "error",
        title: t("browser.extensions.updateFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    setPending(false);
  };

  const addExtension = async () => {
    const bridge = extensionsBridge;
    const pickFolder = window.desktopBridge?.pickFolder;
    if (!bridge || !pickFolder) return;
    const path = await pickFolder().catch(() => null);
    if (path === null) return;
    await mutate(path, () => bridge.add(path));
  };

  const controlsDisabled = disabled || pending || extensionsBridge === null;

  return (
    <SettingsRow
      id="browser-extensions"
      title={t("browser.extensions.title")}
      description={t("browser.extensions.description")}
      control={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => setImportOpen(true)}
          >
            <CopyPlusIcon />
            {t("browser.extensions.addFromBrowser")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => void addExtension()}
          >
            <PlusIcon />
            {t("browser.extensions.add")}
          </Button>
        </div>
      }
    >
      <BrowserExtensionImportDialog open={importOpen} onOpenChange={setImportOpen} />
      {extensions.length > 0 ? (
        <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
          {extensions.map((extension, index) => {
            const name = browserExtensionName(extension, t);
            const problem = browserExtensionProblemText(extension, t);
            return (
              <div
                key={extension.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm text-foreground">{name}</span>
                    {extension.version ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("browser.extensions.version", { version: extension.version })}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs break-all text-muted-foreground">
                    {extension.source
                      ? t("browser.extensions.fromSource", {
                          browser: extension.source.sourceName,
                          profile: extension.source.profileName,
                        })
                      : extension.path}
                  </div>
                  {problem ? (
                    <div className="text-xs text-destructive-foreground">{problem}</div>
                  ) : null}
                </div>
                <Switch
                  aria-label={t("browser.extensions.enableAria", { name })}
                  checked={extension.enabled}
                  disabled={controlsDisabled}
                  onCheckedChange={(enabled) => {
                    const bridge = extensionsBridge;
                    if (!bridge) return;
                    void mutate(extension.path, () =>
                      bridge.setEnabled(extension.path, Boolean(enabled)),
                    );
                  }}
                />
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={t("browser.extensions.removeAria", { name })}
                  disabled={controlsDisabled}
                  onClick={() => {
                    const bridge = extensionsBridge;
                    if (!bridge) return;
                    void mutate(extension.path, () => bridge.remove(extension.path));
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </SettingsRow>
  );
}
