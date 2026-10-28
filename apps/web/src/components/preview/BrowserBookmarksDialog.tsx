import { ChevronRightIcon, FolderIcon, GlobeIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { BrowserBookmarkNode } from "~/browserBookmarks.logic";
import { useBookmarkRoots } from "~/browserBookmarksStore";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { bookmarkDisplayTitle, deleteBookmarkWithUndo } from "./browserBookmarkActions";

/**
 * Every bookmark as a tree. Folders start collapsed and render their rows only while open, so
 * a large import costs nothing until it is browsed; rows use a generic icon for the same reason.
 */
export function BrowserBookmarksDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenUrl: (url: string) => void;
  readonly onImport: () => void;
}) {
  const t = useT();
  const roots = useBookmarkRoots();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const empty = roots.bookmarkBar.length === 0 && roots.other.length === 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("browser.bookmarks.dialog.title")}</DialogTitle>
          <DialogDescription>{t("browser.bookmarks.dialog.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {empty ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("browser.bookmarks.dialog.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {(
                [
                  ["bookmarkBar", t("browser.bookmarks.bookmarkBar")],
                  ["other", t("browser.bookmarks.other")],
                ] as const
              ).map(([key, label]) =>
                roots[key].length === 0 ? null : (
                  <section key={key} className="flex flex-col">
                    <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
                    <BookmarkRows
                      nodes={roots[key]}
                      depth={0}
                      expanded={expanded}
                      onToggle={toggle}
                      onOpenUrl={(url) => {
                        props.onOpenChange(false);
                        props.onOpenUrl(url);
                      }}
                    />
                  </section>
                ),
              )}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onImport}>
            {t("browser.bookmarks.import")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function BookmarkRows(props: {
  readonly nodes: ReadonlyArray<BrowserBookmarkNode>;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onOpenUrl: (url: string) => void;
}) {
  const t = useT();
  if (props.nodes.length === 0) {
    return (
      <p
        className="py-1 text-xs text-muted-foreground"
        style={{ paddingInlineStart: `${props.depth * 16 + 32}px` }}
      >
        {t("browser.bookmarks.emptyFolder")}
      </p>
    );
  }
  return props.nodes.map((node) => {
    const title = bookmarkDisplayTitle(node);
    const isOpen = node.kind === "folder" && props.expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="group flex min-w-0 items-center gap-1 rounded-md pe-1 hover:bg-accent/40"
          style={{ paddingInlineStart: `${props.depth * 16}px` }}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-expanded={node.kind === "folder" ? isOpen : undefined}
            aria-label={
              node.kind === "folder"
                ? t(
                    isOpen ? "browser.bookmarks.collapseFolder" : "browser.bookmarks.expandFolder",
                    {
                      title,
                    },
                  )
                : undefined
            }
            onClick={() =>
              node.kind === "folder" ? props.onToggle(node.id) : props.onOpenUrl(node.url)
            }
          >
            {node.kind === "folder" ? (
              <>
                <ChevronRightIcon
                  className={cn("size-3.5 shrink-0 text-muted-foreground", isOpen && "rotate-90")}
                />
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              </>
            ) : (
              <GlobeIcon className="ms-5.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{title}</span>
          </button>
          <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("browser.bookmarks.delete", { title })}
              onClick={() => deleteBookmarkWithUndo(node)}
            >
              <Trash2Icon />
            </Button>
          </span>
        </div>
        {isOpen && node.kind === "folder" ? (
          <BookmarkRows {...props} nodes={node.children} depth={props.depth + 1} />
        ) : null}
      </div>
    );
  });
}
