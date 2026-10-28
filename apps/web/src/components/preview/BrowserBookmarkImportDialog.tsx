import type { BrowserBookmarkSource, BrowserBookmarkTreeNode } from "@t3tools/contracts";
import { FileUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bookmarkFileImport, type BrowserBookmarkImportSource } from "~/browserBookmarks.logic";
import { useBrowserBookmarksStore } from "~/browserBookmarksStore";
import { useT } from "~/i18n";

import { SelectableTile } from "../settings/BrowserImportWizard";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { previewBridge } from "./previewBridge";

// Chrome's own exports run to a few megabytes for thousands of bookmarks.
const MAX_BOOKMARK_FILE_BYTES = 32 * 1024 * 1024;

type ProfileChoice = {
  readonly key: string;
  readonly source: BrowserBookmarkSource;
  readonly directory: string;
  readonly profileName: string;
};

function profileChoices(sources: ReadonlyArray<BrowserBookmarkSource>): ProfileChoice[] {
  return sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      key: `${source.id}\u0000${profile.directory}`,
      source,
      directory: profile.directory,
      profileName: profile.name,
    })),
  );
}

/**
 * Imports Chrome-family bookmarks: on desktop straight from a local browser profile, anywhere
 * from an exported bookmarks HTML file.
 */
export function BrowserBookmarkImportDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sources, setSources] = useState<ReadonlyArray<BrowserBookmarkSource> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists bookmark sources from the desktop bridge when the dialog opens, ignoring results after cleanup
  useEffect(() => {
    if (!open || !previewBridge) return;
    let cancelled = false;
    void previewBridge
      .listBrowserBookmarkSources()
      .catch(() => [] as ReadonlyArray<BrowserBookmarkSource>)
      .then((listed) => {
        if (!cancelled) setSources(listed);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const choices = profileChoices(sources ?? []);
  const selected = choices.find((choice) => choice.key === selectedKey) ?? choices[0] ?? null;

  const close = () => {
    setError(null);
    onOpenChange(false);
  };

  const finish = (input: {
    readonly nodes: ReadonlyArray<BrowserBookmarkTreeNode>;
    readonly importSource: BrowserBookmarkImportSource;
    readonly title: string;
  }) => {
    if (input.nodes.length === 0) {
      setError(t("browser.bookmarks.import.fileEmpty"));
      return;
    }
    const outcome = useBrowserBookmarksStore.getState().importFolder(input);
    if (!outcome.ok) {
      setError(t("browser.bookmarks.storageFull"));
      return;
    }
    toastManager.add({
      type: "success",
      title: t("browser.bookmarks.import.done", { count: outcome.bookmarkCount }),
    });
    close();
  };

  const importFromBrowser = async (choice: ProfileChoice) => {
    if (!previewBridge) return;
    setError(null);
    setImporting(true);
    const result = await previewBridge
      .readBrowserBookmarks({
        sourceId: choice.source.id,
        sourceProfileDirectory: choice.directory,
      })
      .catch(() => null);
    setImporting(false);
    if (result === null) {
      setError(t("browser.bookmarks.import.readFailed"));
      return;
    }
    finish({
      nodes: result.roots,
      importSource: { sourceId: choice.source.id, profileId: choice.directory },
      title:
        choice.source.profiles.length > 1
          ? `${choice.source.name} (${choice.profileName})`
          : choice.source.name,
    });
  };

  const importFromFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BOOKMARK_FILE_BYTES) {
      setError(t("browser.bookmarks.import.readFailed"));
      return;
    }
    setImporting(true);
    const text = await file.text().catch(() => null);
    setImporting(false);
    if (text === null) {
      setError(t("browser.bookmarks.import.readFailed"));
      return;
    }
    finish(bookmarkFileImport(file.name, text));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || importing ? undefined : close())}>
      <DialogPopup className="max-w-lg" showCloseButton={!importing}>
        <DialogHeader>
          <DialogTitle>{t("browser.bookmarks.import")}</DialogTitle>
          <DialogDescription>{t("browser.bookmarks.import.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            {previewBridge ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-foreground">
                  {t("browser.bookmarks.import.fromBrowser")}
                </h3>
                {sources === null ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="sm" tone="muted" />
                    {t("browser.bookmarks.import.lookingForBrowsers")}
                  </div>
                ) : choices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("browser.bookmarks.import.noBrowsers")}
                  </p>
                ) : (
                  choices.map((choice) => (
                    <SelectableTile
                      key={choice.key}
                      selected={choice.key === selected?.key}
                      title={choice.source.name}
                      subtitle={choice.profileName}
                      onSelect={() => setSelectedKey(choice.key)}
                    />
                  ))
                )}
              </section>
            ) : null}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">
                {t("browser.bookmarks.import.fromFile")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("browser.bookmarks.import.fileHint")}
              </p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUpIcon />
                  {t("browser.bookmarks.import.chooseFile")}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importFromFile(file);
                }}
              />
            </section>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose disabled={importing} render={<Button variant="outline" />}>
            {t("common.cancel")}
          </DialogClose>
          {previewBridge ? (
            <Button
              disabled={importing || selected === null}
              onClick={() => {
                if (selected) void importFromBrowser(selected);
              }}
            >
              {importing ? <Spinner /> : null}
              {importing ? t("browser.bookmarks.import.importing") : t("browser.bookmarks.import")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
