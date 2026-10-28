import type { ScopedThreadRef } from "@t3tools/contracts";
import { FolderIcon, GlobeIcon, History, Star, TrendingUp, X } from "lucide-react";

import type { BrowserBookmarkNode } from "~/browserBookmarks.logic";
import { useBrowserBookmarksStore } from "~/browserBookmarksStore";
import { useFaviconForUrlInAnyProject } from "~/browserFaviconStore";
import {
  type BrowserHistoryEntry,
  useBrowserHistoryStore,
  useMostVisitedSites,
  useRecentBrowserHistory,
} from "~/browserHistoryStore";
import { t as getMessage, useT } from "~/i18n";
import { faviconUrlForOrigin } from "~/lib/favicon";

import { Button } from "../ui/button";
import { DiscoveryList } from "../ui/discovery-list";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { bookmarkDisplayTitle } from "./browserBookmarkActions";
import { FaviconImage } from "./PreviewFaviconIcon";
import { PreviewRecentUrlCard } from "./PreviewRecentUrlCard";

// The bar shows its first items with favicons; the rest live behind "All bookmarks". Folder
// menus cap their rows for the same reason: a big import should not mount thousands at once.
const BOOKMARK_BAR_LIMIT = 24;
const FOLDER_MENU_LIMIT = 100;
const MOST_VISITED_LIMIT = 8;
const RECENT_LIMIT = 10;

export function SectionHeading(props: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {props.icon}
      <h2 className="min-w-0 flex-1 truncate font-medium">{props.title}</h2>
      {props.action}
    </div>
  );
}

function SiteFavicon(props: { readonly threadRef: ScopedThreadRef; readonly url: string }) {
  const captured = useFaviconForUrlInAnyProject(props.threadRef, props.url);
  return (
    <FaviconImage
      sources={[captured, faviconUrlForOrigin(props.url, 32)]}
      fallback={<GlobeIcon className="size-4 shrink-0 text-muted-foreground" />}
      className="size-4 shrink-0 rounded-sm object-contain"
    />
  );
}

function FolderMenuItems(props: {
  readonly nodes: ReadonlyArray<BrowserBookmarkNode>;
  readonly onOpenUrl: (url: string) => void;
  readonly onShowAll: () => void;
}) {
  const t = useT();
  if (props.nodes.length === 0) {
    return <MenuItem disabled>{t("browser.bookmarks.emptyFolder")}</MenuItem>;
  }
  return (
    <>
      {props.nodes.slice(0, FOLDER_MENU_LIMIT).map((node) =>
        node.kind === "folder" ? (
          <MenuSub key={node.id}>
            <MenuSubTrigger>
              <FolderIcon />
              <MenuItemLabel>{bookmarkDisplayTitle(node)}</MenuItemLabel>
            </MenuSubTrigger>
            <MenuSubPopup>
              <FolderMenuItems {...props} nodes={node.children} />
            </MenuSubPopup>
          </MenuSub>
        ) : (
          <MenuItem key={node.id} onClick={() => props.onOpenUrl(node.url)}>
            <GlobeIcon />
            <MenuItemLabel>{bookmarkDisplayTitle(node)}</MenuItemLabel>
          </MenuItem>
        ),
      )}
      {props.nodes.length > FOLDER_MENU_LIMIT ? (
        <MenuItem onClick={props.onShowAll}>{t("browser.newTab.moreInFolder")}</MenuItem>
      ) : null}
    </>
  );
}

export function NewTabBookmarkBar(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenUrl: (url: string) => void;
  readonly onShowAll: () => void;
}) {
  const t = useT();
  const bookmarkBar = useBrowserBookmarksStore((state) => state.bookmarkBar);
  const hasOther = useBrowserBookmarksStore((state) => state.other.length > 0);
  if (bookmarkBar.length === 0 && !hasOther) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        icon={<Star className="size-4 shrink-0" />}
        title={t("browser.newTab.bookmarks")}
        action={
          <Button variant="ghost" size="xs" onClick={props.onShowAll}>
            {t("browser.newTab.allBookmarks")}
          </Button>
        }
      />
      {bookmarkBar.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {bookmarkBar.slice(0, BOOKMARK_BAR_LIMIT).map((node) =>
            node.kind === "folder" ? (
              <Menu key={node.id}>
                <MenuTrigger render={<Button variant="ghost" size="sm" className="max-w-48" />}>
                  <FolderIcon />
                  <span className="truncate">{bookmarkDisplayTitle(node)}</span>
                </MenuTrigger>
                <MenuPopup align="start">
                  <FolderMenuItems
                    nodes={node.children}
                    onOpenUrl={props.onOpenUrl}
                    onShowAll={props.onShowAll}
                  />
                </MenuPopup>
              </Menu>
            ) : (
              <Button
                key={node.id}
                variant="ghost"
                size="sm"
                className="max-w-48"
                onClick={() => props.onOpenUrl(node.url)}
              >
                <SiteFavicon threadRef={props.threadRef} url={node.url} />
                <span className="truncate">{bookmarkDisplayTitle(node)}</span>
              </Button>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

function siteLabel(entry: BrowserHistoryEntry): string {
  if (entry.title) return entry.title;
  try {
    return new URL(entry.url).host;
  } catch {
    return entry.url;
  }
}

function hideMostVisited(entry: BrowserHistoryEntry): void {
  useBrowserHistoryStore.getState().hideTopSite(entry.url);
  const toastId = toastManager.add({
    type: "success",
    title: getMessage("browser.newTab.mostVisitedRemoved"),
    actionProps: {
      children: getMessage("browser.newTab.undo"),
      onClick: () => {
        toastManager.close(toastId);
        useBrowserHistoryStore.getState().unhideTopSite(entry.url);
      },
    },
  });
}

export function NewTabMostVisited(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenUrl: (url: string) => void;
}) {
  const t = useT();
  const sites = useMostVisitedSites(MOST_VISITED_LIMIT);
  const hasHidden = useBrowserHistoryStore((state) => state.hiddenTopSiteKeys.length > 0);
  if (sites.length === 0 && !hasHidden) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        icon={<TrendingUp className="size-4 shrink-0" />}
        title={t("browser.newTab.mostVisited")}
        action={
          hasHidden ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => useBrowserHistoryStore.getState().restoreHiddenTopSites()}
            >
              {t("browser.newTab.restoreMostVisited")}
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sites.map((entry) => {
          const label = siteLabel(entry);
          return (
            <div key={entry.url} className="group relative">
              <button
                type="button"
                onClick={() => props.onOpenUrl(entry.url)}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-border/70 px-2 py-3 text-center hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <SiteFavicon threadRef={props.threadRef} url={entry.url} />
                <span className="w-full truncate text-xs text-foreground">{label}</span>
              </button>
              <button
                type="button"
                aria-label={t("browser.newTab.removeMostVisited", { title: label })}
                onClick={() => hideMostVisited(entry)}
                className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function NewTabRecent(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenUrl: (url: string) => void;
}) {
  const t = useT();
  const entries = useRecentBrowserHistory(RECENT_LIMIT).filter((entry) => URL.canParse(entry.url));
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        icon={<History className="size-4 shrink-0" />}
        title={t("browser.newTab.recent")}
      />
      <DiscoveryList>
        {entries.map((entry) => (
          <PreviewRecentUrlCard
            key={entry.url}
            threadRef={props.threadRef}
            entry={entry}
            onOpen={() => props.onOpenUrl(entry.url)}
            onRemove={() => useBrowserHistoryStore.getState().removeUrlEverywhere(entry.url)}
          />
        ))}
      </DiscoveryList>
    </section>
  );
}
