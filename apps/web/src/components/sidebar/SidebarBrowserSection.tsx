import { closestCenter, DndContext, type DragEndEvent, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthPreviewOperateScope,
  type ContextMenuItem,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { Globe2Icon, PinIcon, PinOffIcon, PlusIcon, XIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useRef,
  useState,
} from "react";

import { BrowserExtensionsUpdateButton } from "~/browser/BrowserExtensionsUpdate";
import {
  useBrowserWorkspaceCommands,
  useBrowserWorkspaceThreadRef,
} from "~/browser/useBrowserWorkspace";
import type { BrowserWorkspaceTab } from "~/browserWorkspace.logic";
import { useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { FaviconImage } from "~/components/preview/PreviewFaviconIcon";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useT } from "~/i18n";
import { shortcutLabelForCommand } from "~/keybindings";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useThreadPreviewState } from "~/previewStateStore";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";

import { SidebarPointerSensor } from "../Sidebar.pointer";
import { Button } from "../ui/button";
import { SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { deriveSidebarBrowserTabs, type SidebarBrowserTab } from "./sidebarBrowserTabs.logic";
import { SidebarLayerHeader } from "./SidebarLayerHeader";
import { SidebarRecentlyClosedTabs } from "./SidebarRecentlyClosedTabs";

// Module-level: useSensor memoizes on these options and DndContext on the modifiers array,
// so fresh ones per render would re-render every row.
const TAB_SENSOR_OPTIONS = { distance: 6, onAttach: () => {}, onFinish: () => {} };
const TAB_DRAG_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];

type TabMenuAction = "pin" | "unpin" | "rename" | "move-to-thread" | "close";

/**
 * The browser workspace's tabs as a vertical tab strip. The list is the same on every page;
 * a tab opens on the workspace page, apart from any thread's own browser panel.
 */
export function SidebarBrowserSection() {
  const threadRef = useBrowserWorkspaceThreadRef();
  if (!threadRef) return null;
  return <SidebarBrowserWorkspaceSection threadRef={threadRef} />;
}

function SidebarBrowserWorkspaceSection({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const t = useT();
  const { isMobile, setOpenMobile } = useSidebar();
  const canOperatePreview = useEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const workspaceShown = useLocation({ select: (location) => location.pathname === "/browser" });
  const workspaceTabs = useBrowserWorkspaceStore((state) => state.tabs);
  const activeTabId = useBrowserWorkspaceStore((state) => state.activeTabId);
  const hasMoveTarget = useBrowserWorkspaceStore((state) => state.lastThreadTarget !== null);
  const previewState = useThreadPreviewState(threadRef);
  const commands = useBrowserWorkspaceCommands();
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const tabs = deriveSidebarBrowserTabs({
    tabs: workspaceTabs,
    activeTabId,
    workspaceShown,
    sessions: previewState.sessions,
    desktopByTabId: previewState.desktopByTabId,
  });

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const activateTab = useStableCallback((tab: BrowserWorkspaceTab) => {
    commands.showTab(tab.id);
    closeMobileSidebar();
  });
  const closeTab = useStableCallback((tab: BrowserWorkspaceTab) => commands.closeTab(tab.id));
  const unpinTab = useStableCallback((tab: BrowserWorkspaceTab) =>
    useBrowserWorkspaceStore.getState().setPinned(tab.id, false),
  );
  const startRename = useStableCallback((tab: BrowserWorkspaceTab) => setRenamingTabId(tab.id));
  const finishRename = useStableCallback((tab: BrowserWorkspaceTab, name: string | null) => {
    setRenamingTabId(null);
    if (name !== null) useBrowserWorkspaceStore.getState().renameTab(tab.id, name);
  });
  const showTabMenu = useStableCallback(
    async (event: ReactMouseEvent, tab: BrowserWorkspaceTab) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;
      const items: ContextMenuItem<TabMenuAction>[] = [
        tab.pinned
          ? { id: "unpin", label: t("browser.sidebar.unpinTab") }
          : { id: "pin", label: t("browser.sidebar.pinTab") },
        { id: "rename", label: t("browser.sidebar.renameTab") },
        {
          id: "move-to-thread",
          label: t("browser.workspace.moveToThread"),
          disabled: !hasMoveTarget || !canOperatePreview,
        },
        ...(tab.pinned
          ? []
          : [
              {
                id: "close" as const,
                label: t("browser.sidebar.closeTabMenu"),
                separatorBefore: true,
              },
            ]),
      ];
      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "pin":
        case "unpin":
          useBrowserWorkspaceStore.getState().setPinned(tab.id, action === "pin");
          break;
        case "rename":
          setRenamingTabId(tab.id);
          break;
        case "move-to-thread":
          closeMobileSidebar();
          await commands.moveToThread(tab.id);
          break;
        case "close":
          commands.closeTab(tab.id);
          break;
        case null:
          break;
      }
    },
  );
  const openNewTab = () => {
    closeMobileSidebar();
    commands.newTab();
  };

  const newTabShortcut = shortcutLabelForCommand(keybindings, "preview.newTab");
  const newTabLabel = newTabShortcut
    ? t("browser.sidebar.newTabWithShortcut", { shortcut: newTabShortcut })
    : t("browser.sidebar.newTab");

  return (
    <SidebarGroup data-testid="sidebar-browser-section">
      <SidebarLayerHeader label={t("browser.sidebar.section")}>
        <BrowserExtensionsUpdateButton />
        <SidebarRecentlyClosedTabs disabled={!canOperatePreview} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={newTabLabel}
                disabled={!canOperatePreview}
                onClick={openNewTab}
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{newTabLabel}</TooltipPopup>
        </Tooltip>
      </SidebarLayerHeader>
      {tabs.length > 0 ? (
        <SidebarBrowserTabList
          tabs={tabs}
          onActivate={activateTab}
          onClose={closeTab}
          onUnpin={unpinTab}
          onContextMenu={showTabMenu}
          renamingTabId={renamingTabId}
          onStartRename={startRename}
          onFinishRename={finishRename}
        />
      ) : null}
      <div aria-hidden className="mx-2 mt-2 border-t border-sidebar-border" />
    </SidebarGroup>
  );
}

/**
 * Dragging reorders the workspace's tabs within the pinned or the unpinned group.
 * Exported for the drag test; it needs none of the section's environment wiring.
 */
export function SidebarBrowserTabList(props: {
  readonly tabs: ReadonlyArray<SidebarBrowserTab>;
  readonly onActivate: (tab: BrowserWorkspaceTab) => void;
  readonly onClose: (tab: BrowserWorkspaceTab) => void;
  readonly onUnpin: (tab: BrowserWorkspaceTab) => void;
  readonly onContextMenu: (event: ReactMouseEvent, tab: BrowserWorkspaceTab) => void;
  readonly renamingTabId: string | null;
  readonly onStartRename: (tab: BrowserWorkspaceTab) => void;
  /** `null` cancels the rename. */
  readonly onFinishRename: (tab: BrowserWorkspaceTab, name: string | null) => void;
}) {
  const t = useT();
  // No KeyboardSensor: its Enter and Space activators would stop those keys opening the tab.
  const sensors = useSensors(useSensor(SidebarPointerSensor, TAB_SENSOR_OPTIONS));
  const sortableIds = props.tabs.map((row) => row.tab.id);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    useBrowserWorkspaceStore.getState().moveTab(String(active.id), String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={TAB_DRAG_MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul aria-label={t("browser.sidebar.tabsLabel")} className="flex flex-col gap-px">
          {props.tabs.map((row) => (
            <SidebarBrowserTabRow
              key={row.tab.id}
              row={row}
              blankLabel={t("browser.sidebar.blankTab")}
              onActivate={props.onActivate}
              onClose={props.onClose}
              onUnpin={props.onUnpin}
              onContextMenu={props.onContextMenu}
              renaming={props.renamingTabId === row.tab.id}
              onStartRename={props.onStartRename}
              onFinishRename={props.onFinishRename}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SidebarBrowserTabRow(props: {
  readonly row: SidebarBrowserTab;
  readonly blankLabel: string;
  readonly onActivate: (tab: BrowserWorkspaceTab) => void;
  readonly onClose: (tab: BrowserWorkspaceTab) => void;
  readonly onUnpin: (tab: BrowserWorkspaceTab) => void;
  readonly onContextMenu: (event: ReactMouseEvent, tab: BrowserWorkspaceTab) => void;
  readonly renaming: boolean;
  readonly onStartRename: (tab: BrowserWorkspaceTab) => void;
  readonly onFinishRename: (tab: BrowserWorkspaceTab, name: string | null) => void;
}) {
  const t = useT();
  const { row } = props;
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.tab.id,
    disabled: props.renaming,
  });
  const title = row.title ?? props.blankLabel;
  const onAuxClick = (event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    props.onClose(row.tab);
  };
  const onDoubleClick = (event: ReactMouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    props.onStartRename(row.tab);
  };
  const favicon = (
    <FaviconImage
      sources={[row.capturedFaviconUrl, row.url ? faviconUrlForOrigin(row.url, 32) : null]}
      fallback={<Globe2Icon className="size-3.5 shrink-0" />}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
  return (
    <li
      ref={setNodeRef}
      className={cn("group/browser-tab relative", isDragging && "z-10")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {props.renaming ? (
        <div className="flex h-7 w-full items-center gap-2 rounded-md bg-sidebar-row-active ps-2.5 pe-1.5">
          {favicon}
          <SidebarBrowserTabNameInput
            initialName={row.title ?? ""}
            onFinish={(name) => props.onFinishRename(row.tab, name)}
            ariaLabel={t("browser.sidebar.tabNameInput")}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-current={row.active ? "page" : undefined}
            {...listeners}
            onClick={() => props.onActivate(row.tab)}
            onDoubleClick={onDoubleClick}
            onAuxClick={onAuxClick}
            onContextMenu={(event) => props.onContextMenu(event, row.tab)}
            className={cn(
              "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md ps-2.5 pe-7 text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              row.active
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            {favicon}
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </button>
          {row.tab.pinned ? (
            // A pinned tab shows its pin where the close button would be; it closes only once
            // it is unpinned.
            <span className="absolute inset-y-0 end-1 flex items-center">
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={t("browser.sidebar.unpinTabNamed", { title })}
                onClick={() => props.onUnpin(row.tab)}
              >
                <PinIcon className="size-3 group-hover/browser-tab:hidden group-focus-within/browser-tab:hidden" />
                <PinOffIcon className="hidden size-3 group-hover/browser-tab:block group-focus-within/browser-tab:block" />
              </Button>
            </span>
          ) : (
            <span
              className={cn(
                "absolute inset-y-0 end-1 flex items-center",
                !row.active &&
                  "opacity-0 group-hover/browser-tab:opacity-100 focus-within:opacity-100",
              )}
            >
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={t("browser.sidebar.closeTab", { title })}
                onClick={() => props.onClose(row.tab)}
              >
                <XIcon className="size-3" />
              </Button>
            </span>
          )}
        </>
      )}
    </li>
  );
}

/** Enter or leaving the field saves, Escape cancels; an empty name restores the page title. */
function SidebarBrowserTabNameInput(props: {
  readonly initialName: string;
  readonly ariaLabel: string;
  readonly onFinish: (name: string | null) => void;
}) {
  const [name, setName] = useState(props.initialName);
  const finishedRef = useRef(false);
  const finish = (next: string | null) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // Confirming the shown title untouched must not pin it as a name the page can no longer change.
    props.onFinish(next?.trim() === props.initialName.trim() ? null : next);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
    }
  };
  return (
    <input
      autoFocus
      value={name}
      dir="auto"
      aria-label={props.ariaLabel}
      onChange={(event) => setName(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={() => finish(name)}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm text-card-foreground outline-none focus:border-foreground"
    />
  );
}
