import { Globe2Icon, HistoryIcon } from "lucide-react";
import { useState } from "react";

import { useBrowserWorkspaceCommands } from "~/browser/useBrowserWorkspace";
import { useClosedViewStore } from "~/closedViewStore";
import { FaviconImage } from "~/components/preview/PreviewFaviconIcon";
import { useT } from "~/i18n";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { formatRelativeElapsed } from "~/timestampFormat";

import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { recentlyClosedBrowserTabs } from "./sidebarBrowserTabs.logic";

const relativeLabel = (closedAt: number, now: number) => {
  const relative = formatRelativeElapsed(Math.max(0, now - closedAt));
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
};

/** Closed browser tabs from anywhere; picking one reopens it in the browser workspace. */
export function SidebarRecentlyClosedTabs(props: { readonly disabled: boolean }) {
  const t = useT();
  const commands = useBrowserWorkspaceCommands();
  const entries = useClosedViewStore((state) => state.entries);
  // Read when the menu opens so the "how long ago" labels are current without a ticking timer.
  const [now, setNow] = useState(0);
  const closedTabs = recentlyClosedBrowserTabs(entries);
  const label = t("browser.sidebar.recentlyClosed");
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) setNow(Date.now());
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={label}
                  disabled={props.disabled}
                />
              }
            />
          }
        >
          <HistoryIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" sideOffset={6} className="w-72">
        <MenuGroup>
          <MenuGroupLabel>{label}</MenuGroupLabel>
          {closedTabs.length === 0 ? (
            <MenuItem disabled>{t("browser.sidebar.recentlyClosedEmpty")}</MenuItem>
          ) : (
            closedTabs.map((closed) => (
              <MenuItem key={closed.entry.id} onClick={() => commands.reopenClosed(closed.entry)}>
                <FaviconImage
                  sources={[closed.url ? faviconUrlForOrigin(closed.url, 32) : null]}
                  fallback={<Globe2Icon className="size-3.5 shrink-0" />}
                  className="size-3.5 shrink-0 rounded-sm object-contain"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <MenuItemLabel>{closed.title ?? t("browser.sidebar.blankTab")}</MenuItemLabel>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      closed.host,
                      closed.closedAt === null ? null : relativeLabel(closed.closedAt, now),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
              </MenuItem>
            ))
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
