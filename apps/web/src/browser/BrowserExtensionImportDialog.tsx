import type { BrowserExtensionSourceBrowser } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { SelectableTile } from "~/components/settings/BrowserImportWizard";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { useT } from "~/i18n";

import { browserExtensionImportToast, isBrowserExtensionCopied } from "./browserExtensions.logic";
import {
  browserExtensionsBridge,
  setBrowserExtensions,
  useBrowserExtensionsStore,
} from "./browserExtensionsStore";

type ProfileChoice = {
  readonly key: string;
  readonly source: BrowserExtensionSourceBrowser;
  readonly profile: BrowserExtensionSourceBrowser["profiles"][number];
};

const profileChoices = (sources: ReadonlyArray<BrowserExtensionSourceBrowser>): ProfileChoice[] =>
  sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      key: `${source.id}\u0000${profile.directory}`,
      source,
      profile,
    })),
  );

/** Copies extensions from a local Chromium-based browser profile; desktop only. */
export function BrowserExtensionImportDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const t = useT();
  const extensions = useBrowserExtensionsStore((state) => state.extensions);
  const [sources, setSources] = useState<ReadonlyArray<BrowserExtensionSourceBrowser> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists extension sources from the desktop bridge when the dialog opens, ignoring results after cleanup
  useEffect(() => {
    if (!open || !browserExtensionsBridge) return;
    let cancelled = false;
    void browserExtensionsBridge
      .listSources()
      .catch(() => [] as ReadonlyArray<BrowserExtensionSourceBrowser>)
      .then((listed) => {
        if (!cancelled) setSources(listed);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const choices = profileChoices(sources ?? []);
  const selected = choices.find((choice) => choice.key === selectedKey) ?? choices[0] ?? null;
  const copied = (extensionId: string) => isBrowserExtensionCopied(extensions, extensionId);
  const pickedIds =
    selected?.profile.extensions
      .map((extension) => extension.extensionId)
      .filter((extensionId) => picked.has(extensionId) && !copied(extensionId)) ?? [];

  const close = () => {
    setPicked(new Set());
    onOpenChange(false);
  };

  const add = async () => {
    const bridge = browserExtensionsBridge;
    if (!bridge || selected === null || pickedIds.length === 0) return;
    setAdding(true);
    const result = await bridge
      .addFromSource({
        sourceId: selected.source.id,
        profileDirectory: selected.profile.directory,
        extensionIds: pickedIds,
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: t("browser.extensions.import.failed"),
          description: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    setAdding(false);
    if (result === null) return;
    setBrowserExtensions(result.extensions);
    const toast = browserExtensionImportToast(result, pickedIds, t);
    if (toast) toastManager.add(toast);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || adding ? undefined : close())}>
      <DialogPopup className="max-w-lg" showCloseButton={!adding}>
        <DialogHeader>
          <DialogTitle>{t("browser.extensions.import.title")}</DialogTitle>
          <DialogDescription>{t("browser.extensions.import.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {sources === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" tone="muted" />
              {t("browser.extensions.import.lookingForBrowsers")}
            </div>
          ) : choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("browser.extensions.import.noBrowsers")}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <section className="flex flex-col gap-2">
                {choices.map((choice) => (
                  <SelectableTile
                    key={choice.key}
                    selected={choice.key === selected?.key}
                    title={choice.source.name}
                    subtitle={choice.profile.name}
                    onSelect={() => {
                      setSelectedKey(choice.key);
                      setPicked(new Set());
                    }}
                  />
                ))}
              </section>
              {selected ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    {t("browser.extensions.import.extensions")}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-border/60">
                    {selected.profile.extensions.map((extension) => {
                      const alreadyCopied = copied(extension.extensionId);
                      return (
                        <label
                          key={extension.extensionId}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm not-last:border-b has-disabled:cursor-not-allowed has-disabled:opacity-64"
                        >
                          <Checkbox
                            checked={alreadyCopied || picked.has(extension.extensionId)}
                            disabled={alreadyCopied || adding}
                            onCheckedChange={(checked) =>
                              setPicked((current) => {
                                const next = new Set(current);
                                if (checked) next.add(extension.extensionId);
                                else next.delete(extension.extensionId);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {extension.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {alreadyCopied
                              ? t("browser.extensions.import.alreadyAdded")
                              : t("browser.extensions.version", { version: extension.version })}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose disabled={adding} render={<Button variant="outline" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button disabled={adding || pickedIds.length === 0} onClick={() => void add()}>
            {adding ? <Spinner /> : null}
            {adding
              ? t("browser.extensions.import.adding")
              : t("browser.extensions.import.confirm", { count: pickedIds.length })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
