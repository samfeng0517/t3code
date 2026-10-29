import { useId, useState } from "react";

import type { BookmarkDestination, BrowserBookmarkNode } from "~/browserBookmarks.logic";
import { useBrowserBookmarksStore } from "~/browserBookmarksStore";
import { useT } from "~/i18n";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { bookmarkDisplayTitle, reportSaveFailed } from "./browserBookmarkActions";

export type BookmarkEditTarget =
  | { readonly mode: "edit"; readonly node: BrowserBookmarkNode }
  | { readonly mode: "create-folder"; readonly destination: BookmarkDestination };

/** Edits a bookmark's name and URL or a folder's name, or names a new folder. */
export function BrowserBookmarkEditDialog(props: {
  readonly target: BookmarkEditTarget;
  readonly onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const { target } = props;
  const node = target.mode === "edit" ? target.node : null;
  const initialTitle =
    node === null
      ? t("browser.bookmarks.newFolderName")
      : node.kind === "folder"
        ? bookmarkDisplayTitle(node)
        : node.title;
  const initialUrl = node?.kind === "bookmark" ? node.url : null;
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [urlError, setUrlError] = useState(false);

  const save = () => {
    const store = useBrowserBookmarksStore.getState();
    if (node === null) {
      if (target.mode === "create-folder" && store.addFolder(target.destination, title) === null) {
        reportSaveFailed();
      }
      props.onClose();
      return;
    }
    // Saving an untouched imported folder must not turn its localized label into a fixed name.
    if (title === initialTitle && (initialUrl === null || url === initialUrl)) {
      props.onClose();
      return;
    }
    const result = store.updateNode(node.id, initialUrl === null ? { title } : { title, url });
    if (result === "unsupported-url") {
      setUrlError(true);
      return;
    }
    if (result === "storage-full") reportSaveFailed();
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {node === null
                ? t("browser.bookmarks.newFolder")
                : node.kind === "folder"
                  ? t("browser.bookmarks.edit.folderTitle")
                  : t("browser.bookmarks.edit.bookmarkTitle")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-3">
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-title`}>
                {t("browser.bookmarks.edit.name")}
                <Input
                  nativeInput
                  id={`${id}-title`}
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Label>
              {initialUrl === null ? null : (
                <Label className="flex flex-col items-stretch" htmlFor={`${id}-url`}>
                  {t("browser.bookmarks.edit.url")}
                  <Input
                    nativeInput
                    id={`${id}-url`}
                    inputMode="url"
                    aria-invalid={urlError || undefined}
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setUrlError(false);
                    }}
                  />
                </Label>
              )}
              {urlError ? (
                <p role="alert" className="text-destructive text-sm">
                  {t("browser.bookmarks.edit.invalidUrl")}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("browser.bookmarks.edit.save")}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
