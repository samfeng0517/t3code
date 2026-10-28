import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { RadioTower, Search, Star } from "lucide-react";
import { useState } from "react";

import { useBrowserBookmarksStore } from "~/browserBookmarksStore";
import { useT } from "~/i18n";

import { Button } from "../ui/button";
import { DiscoveryList } from "../ui/discovery-list";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { BrowserBookmarkImportDialog } from "./BrowserBookmarkImportDialog";
import { BrowserBookmarksDialog } from "./BrowserBookmarksDialog";
import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import {
  NewTabBookmarkBar,
  NewTabMostVisited,
  NewTabRecent,
  SectionHeading,
} from "./PreviewNewTabSections";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  /** A thread's panel also lists the project's local servers; the workspace has no project. */
  showLocalServers: boolean;
  /** Address bar input: an address opens, anything else searches. */
  onSubmitQuery: (query: string) => void;
  onOpenUrl: (url: string) => void;
}

/**
 * The new tab page. Each section subscribes to its own slice of the bookmark and history
 * stores, so a visit recorded elsewhere repaints only the section it changes.
 */
export function PreviewEmptyState({
  threadRef,
  environmentId,
  configuredUrls,
  showLocalServers,
  onSubmitQuery,
  onOpenUrl,
}: Props) {
  const t = useT();
  const [dialog, setDialog] = useState<"bookmarks" | "import" | null>(null);
  const hasBookmarks = useBrowserBookmarksStore(
    (state) => state.bookmarkBar.length > 0 || state.other.length > 0,
  );
  const showAll = () => setDialog("bookmarks");

  return (
    <div className="scrollbar-gutter-both flex h-full min-h-0 overflow-y-auto px-5 py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {showLocalServers ? (
          <LocalServersSection
            threadRef={threadRef}
            environmentId={environmentId}
            configuredUrls={configuredUrls}
            onOpenUrl={onOpenUrl}
          />
        ) : null}
        <NewTabSearchBox onSubmit={onSubmitQuery} />
        {hasBookmarks ? (
          <NewTabBookmarkBar threadRef={threadRef} onOpenUrl={onOpenUrl} onShowAll={showAll} />
        ) : (
          <section className="flex flex-col gap-3">
            <SectionHeading
              icon={<Star className="size-4 shrink-0" />}
              title={t("browser.newTab.bookmarks")}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 px-4 py-3">
              <p className="text-sm text-muted-foreground">{t("browser.newTab.importHint")}</p>
              <Button variant="outline" size="sm" onClick={() => setDialog("import")}>
                {t("browser.bookmarks.import")}
              </Button>
            </div>
          </section>
        )}
        <NewTabMostVisited threadRef={threadRef} onOpenUrl={onOpenUrl} />
        <NewTabRecent threadRef={threadRef} onOpenUrl={onOpenUrl} />
      </div>
      <BrowserBookmarksDialog
        open={dialog === "bookmarks"}
        onOpenChange={(open) => setDialog(open ? "bookmarks" : null)}
        onOpenUrl={onOpenUrl}
        onImport={() => setDialog("import")}
      />
      <BrowserBookmarkImportDialog
        open={dialog === "import"}
        onOpenChange={(open) => setDialog(open ? "import" : null)}
      />
    </div>
  );
}

function NewTabSearchBox(props: { readonly onSubmit: (query: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (trimmed.length > 0) props.onSubmit(trimmed);
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("browser.newTab.searchPlaceholder")}
          aria-label={t("browser.newTab.searchPlaceholder")}
          spellCheck={false}
          autoCapitalize="none"
          enterKeyHint="go"
        />
      </InputGroup>
    </form>
  );
}

function LocalServersSection(props: {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly configuredUrls?: ReadonlyArray<string> | undefined;
  readonly onOpenUrl: (url: string) => void;
}) {
  const t = useT();
  const servers = useDiscoveredLocalServers({
    environmentId: props.environmentId,
    configuredUrls: props.configuredUrls,
  });
  if (servers.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        icon={<RadioTower className="size-4 shrink-0" />}
        title={t("workspace.preview.empty.localServers")}
      />
      <DiscoveryList>
        {servers.map((server) => (
          <PreviewLocalServerCard
            key={`${server.host}:${server.port}`}
            threadRef={props.threadRef}
            server={server}
            onOpen={() => props.onOpenUrl(server.requestedUrl)}
          />
        ))}
      </DiscoveryList>
      <p className="px-1 text-xs text-muted-foreground">
        {t("workspace.preview.empty.localServersHint")}
      </p>
    </section>
  );
}
