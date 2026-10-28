import {
  ChevronRightIcon,
  FolderIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { type DragEvent, memo, useRef, useState } from "react";

import {
  type BookmarkDestination,
  type BookmarkDropPosition,
  type BrowserBookmarkNode,
  type BrowserBookmarkRootKey,
  type BrowserBookmarkRoots,
  findBookmarkNode,
  resolveBookmarkDrop,
} from "~/browserBookmarks.logic";
import { useBookmarkRoots, useBrowserBookmarksStore } from "~/browserBookmarksStore";
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
import {
  Menu,
  MenuCreateHandle,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { type BookmarkEditTarget, BrowserBookmarkEditDialog } from "./BrowserBookmarkEditDialog";
import {
  bookmarkDisplayTitle,
  deleteBookmarkWithUndo,
  dissolveFolderWithUndo,
  reportSaveFailed,
} from "./browserBookmarkActions";

const ROOT_DROP_PREFIX = "root:";
const ROOT_KEYS = ["bookmarkBar", "other"] as const;
const INDENT_PX = 16;

interface BookmarkDrop {
  readonly overId: string;
  readonly position: BookmarkDropPosition;
  readonly destination: BookmarkDestination;
  /** Relative to the tree, so it scrolls with the rows. */
  readonly indicator: { readonly top: number; readonly left: number; readonly height: number };
}

interface RowMenu {
  readonly node: BrowserBookmarkNode;
  readonly root: BrowserBookmarkRootKey;
}

interface RowActions {
  readonly toggle: (id: string) => void;
  readonly openUrl: (url: string) => void;
  /** Every row's trigger opens this one shared menu, so rows carry no menu state of their own. */
  readonly menuHandle: ReturnType<typeof MenuCreateHandle<RowMenu>>;
  readonly startDrag: (id: string) => void;
  readonly endDrag: () => void;
}

const sameDrop = (a: BookmarkDrop | null, b: BookmarkDrop | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.overId === b.overId &&
    a.position === b.position &&
    a.indicator.top === b.indicator.top);

const rootLabelKey = (root: BrowserBookmarkRootKey) =>
  root === "bookmarkBar" ? "browser.bookmarks.bookmarkBar" : "browser.bookmarks.other";

/**
 * Every bookmark as a tree. Folders start collapsed and render their rows only while open, so
 * a large import costs nothing until it is browsed; rows use a generic icon for the same reason.
 * Native drag events on the tree add no per-row drag state, and the drop target is always the
 * row actually under the pointer, even while the list scrolls.
 */
export function BrowserBookmarksDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenUrl: (url: string) => void;
  readonly onImport: () => void;
}) {
  const t = useT();
  const roots = useBookmarkRoots();
  const treeRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<BookmarkEditTarget | null>(null);
  const [menuHandle] = useState(() => MenuCreateHandle<RowMenu>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<BookmarkDrop | null>(null);
  const { onOpenChange, onOpenUrl } = props;

  const expand = (id: string | null) =>
    setExpanded((current) => (id === null || current.has(id) ? current : new Set(current).add(id)));
  const move = (id: string, destination: BookmarkDestination) => {
    if (!useBrowserBookmarksStore.getState().moveNode(id, destination)) reportSaveFailed();
    expand(destination.parentId);
  };
  const actions: RowActions = {
    toggle: (id) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    openUrl: (url) => {
      onOpenChange(false);
      onOpenUrl(url);
    },
    menuHandle,
    startDrag: setDraggingId,
    endDrag: () => {
      setDraggingId(null);
      setDrop(null);
    },
  };
  const empty = roots.bookmarkBar.length === 0 && roots.other.length === 0;

  const resolveDrop = (event: DragEvent): BookmarkDrop | null => {
    const tree = treeRef.current;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-bookmark-drop]")
        : null;
    if (draggingId === null || tree === null || target === null) return null;
    const overId = target.dataset.bookmarkDrop ?? "";
    const rect = target.getBoundingClientRect();
    const top = rect.top - tree.getBoundingClientRect().top;
    const indent = Number(target.dataset.depth ?? 0) * INDENT_PX;
    if (overId.startsWith(ROOT_DROP_PREFIX)) {
      const root = overId.slice(ROOT_DROP_PREFIX.length) as BrowserBookmarkRootKey;
      const destination = resolveBookmarkDrop(roots, draggingId, { root }, "inside");
      return (
        destination && {
          overId,
          position: "inside",
          destination,
          indicator: { top, left: 0, height: rect.height },
        }
      );
    }
    const node = findBookmarkNode(roots, overId)?.node;
    if (node === undefined) return null;
    const ratio = (event.clientY - rect.top) / rect.height;
    const position: BookmarkDropPosition =
      node.kind === "folder"
        ? ratio < 0.25
          ? "before"
          : ratio > 0.75
            ? "after"
            : "inside"
        : ratio < 0.5
          ? "before"
          : "after";
    const destination = resolveBookmarkDrop(roots, draggingId, { id: overId }, position, expanded);
    if (destination === null) return null;
    const indicator =
      position === "inside"
        ? { top, left: indent, height: rect.height }
        : {
            top: position === "before" ? top : top + rect.height,
            // A line under an open folder means its first child, so it sits one level in.
            left: destination.parentId === overId ? indent + INDENT_PX : indent,
            height: 0,
          };
    return { overId, position, destination, indicator };
  };

  const treeDragProps = {
    onDragOver: (event: DragEvent) => {
      const next = resolveDrop(event);
      if (next) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
      setDrop((current) => (sameDrop(current, next) ? current : next));
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node && treeRef.current?.contains(event.relatedTarget)))
        setDrop(null);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const final = resolveDrop(event);
      if (final && draggingId !== null) move(draggingId, final.destination);
      actions.endDrag();
    },
  };

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
            <div ref={treeRef} className="relative flex flex-col gap-4" {...treeDragProps}>
              {ROOT_KEYS.map((root) => (
                <section key={root} className="flex flex-col">
                  <div
                    data-bookmark-drop={`${ROOT_DROP_PREFIX}${root}`}
                    className="rounded-md px-1 py-1"
                  >
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {t(rootLabelKey(root))}
                    </h3>
                    {roots[root].length === 0 ? (
                      <p className="pt-1 text-xs text-muted-foreground">
                        {t("browser.bookmarks.dropHere")}
                      </p>
                    ) : null}
                  </div>
                  <BookmarkRows
                    nodes={roots[root]}
                    root={root}
                    depth={0}
                    expanded={expanded}
                    draggingId={draggingId}
                    actions={actions}
                  />
                </section>
              ))}
              {drop ? (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute right-1 rounded-md",
                    drop.position === "inside"
                      ? "bg-accent/50 ring-1 ring-ring"
                      : "-mt-px h-0.5 rounded-full bg-primary",
                  )}
                  style={{
                    top: drop.indicator.top,
                    left: drop.indicator.left,
                    height: drop.position === "inside" ? drop.indicator.height : undefined,
                  }}
                />
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              setEditing({
                mode: "create-folder",
                destination: {
                  root: "bookmarkBar",
                  parentId: null,
                  index: roots.bookmarkBar.length,
                },
              })
            }
          >
            {t("browser.bookmarks.newFolder")}
          </Button>
          <Button variant="outline" onClick={props.onImport}>
            {t("browser.bookmarks.import")}
          </Button>
        </DialogFooter>
        <Menu handle={menuHandle}>
          {({ payload: menu }) =>
            menu ? (
              <MenuPopup align="end">
                <BookmarkMenuItems
                  menu={menu}
                  roots={roots}
                  onEdit={setEditing}
                  onMove={(destination) => move(menu.node.id, destination)}
                />
              </MenuPopup>
            ) : null
          }
        </Menu>
        {editing ? (
          <BrowserBookmarkEditDialog
            target={editing}
            onClose={() => {
              if (editing.mode === "create-folder") expand(editing.destination.parentId);
              setEditing(null);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

interface RowsProps {
  readonly nodes: ReadonlyArray<BrowserBookmarkNode>;
  readonly root: BrowserBookmarkRootKey;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly draggingId: string | null;
  readonly actions: RowActions;
}

function BookmarkRows(props: RowsProps) {
  const t = useT();
  if (props.nodes.length === 0) {
    if (props.depth === 0) return null;
    return (
      <p
        className="py-1 text-xs text-muted-foreground"
        style={{ paddingInlineStart: `${props.depth * INDENT_PX + 32}px` }}
      >
        {t("browser.bookmarks.emptyFolder")}
      </p>
    );
  }
  return props.nodes.map((node) => <BookmarkRow key={node.id} {...props} node={node} />);
}

// Memoized so a drag, which only moves the drop indicator, re-renders no rows.
const BookmarkRow = memo(function BookmarkRow(
  props: Omit<RowsProps, "nodes"> & { readonly node: BrowserBookmarkNode },
) {
  const t = useT();
  const { node, actions } = props;
  const title = bookmarkDisplayTitle(node);
  const isOpen = node.kind === "folder" && props.expanded.has(node.id);
  return (
    <div>
      <div
        data-bookmark-drop={node.id}
        data-depth={props.depth}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", title);
          actions.startDrag(node.id);
        }}
        onDragEnd={actions.endDrag}
        className={cn(
          "group flex min-w-0 items-center gap-1 rounded-md pe-1 hover:bg-accent/40",
          props.draggingId === node.id && "opacity-50",
        )}
        style={{ paddingInlineStart: `${props.depth * INDENT_PX}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={node.kind === "folder" ? isOpen : undefined}
          aria-label={
            node.kind === "folder"
              ? t(isOpen ? "browser.bookmarks.collapseFolder" : "browser.bookmarks.expandFolder", {
                  title,
                })
              : undefined
          }
          onClick={() =>
            node.kind === "folder" ? actions.toggle(node.id) : actions.openUrl(node.url)
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
        <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100">
          <MenuTrigger
            handle={actions.menuHandle}
            payload={{ node, root: props.root }}
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("browser.bookmarks.actions", { title })}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
        </span>
      </div>
      {isOpen && node.kind === "folder" ? (
        <BookmarkRows {...props} nodes={node.children} depth={props.depth + 1} />
      ) : null}
    </div>
  );
});

function BookmarkMenuItems(props: {
  readonly menu: RowMenu;
  readonly roots: BrowserBookmarkRoots;
  readonly onEdit: (target: BookmarkEditTarget) => void;
  readonly onMove: (destination: BookmarkDestination) => void;
}) {
  const t = useT();
  const { node, root } = props.menu;
  return (
    <>
      <MenuItem onClick={() => props.onEdit({ mode: "edit", node })}>
        <PencilIcon />
        <MenuItemLabel>{t("browser.bookmarks.edit")}</MenuItemLabel>
      </MenuItem>
      <MenuSub>
        <MenuSubTrigger>
          <FolderIcon />
          <MenuItemLabel>{t("browser.bookmarks.moveTo")}</MenuItemLabel>
        </MenuSubTrigger>
        <MenuSubPopup>
          {ROOT_KEYS.map((key) => (
            <MenuItem
              key={key}
              onClick={() =>
                props.onMove({ root: key, parentId: null, index: props.roots[key].length })
              }
            >
              <MenuItemLabel>{t(rootLabelKey(key))}</MenuItemLabel>
            </MenuItem>
          ))}
          {ROOT_KEYS.some((key) => hasFolderTarget(props.roots[key], node.id)) ? (
            <MenuSeparator />
          ) : null}
          {ROOT_KEYS.map((key) => (
            <MoveTargets
              key={key}
              nodes={props.roots[key]}
              root={key}
              movingId={node.id}
              onMove={props.onMove}
            />
          ))}
        </MenuSubPopup>
      </MenuSub>
      {node.kind === "folder" ? (
        <>
          <MenuItem
            onClick={() =>
              props.onEdit({
                mode: "create-folder",
                destination: { root, parentId: node.id, index: node.children.length },
              })
            }
          >
            <FolderIcon />
            <MenuItemLabel>{t("browser.bookmarks.newFolderHere")}</MenuItemLabel>
          </MenuItem>
          <MenuItem onClick={() => dissolveFolderWithUndo(node)}>
            <FolderIcon />
            <MenuItemLabel>{t("browser.bookmarks.dissolve")}</MenuItemLabel>
          </MenuItem>
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={() => deleteBookmarkWithUndo(node)}>
        <Trash2Icon />
        <MenuItemLabel>{t("browser.bookmarks.deleteMenu")}</MenuItemLabel>
      </MenuItem>
    </>
  );
}

/** The node being moved is skipped, which also leaves out every folder inside it. */
const hasFolderTarget = (nodes: ReadonlyArray<BrowserBookmarkNode>, movingId: string) =>
  nodes.some((node) => node.kind === "folder" && node.id !== movingId);

/** Folders as nested submenus, rendered only as each one opens. */
function MoveTargets(props: {
  readonly nodes: ReadonlyArray<BrowserBookmarkNode>;
  readonly root: BrowserBookmarkRootKey;
  readonly movingId: string;
  readonly onMove: (destination: BookmarkDestination) => void;
}) {
  const t = useT();
  return props.nodes.map((node) => {
    if (node.kind !== "folder" || node.id === props.movingId) return null;
    const title = bookmarkDisplayTitle(node);
    const into: BookmarkDestination = {
      root: props.root,
      parentId: node.id,
      index: node.children.length,
    };
    if (!hasFolderTarget(node.children, props.movingId)) {
      return (
        <MenuItem key={node.id} onClick={() => props.onMove(into)}>
          <FolderIcon />
          <MenuItemLabel>{title}</MenuItemLabel>
        </MenuItem>
      );
    }
    return (
      <MenuSub key={node.id}>
        <MenuSubTrigger>
          <FolderIcon />
          <MenuItemLabel>{title}</MenuItemLabel>
        </MenuSubTrigger>
        <MenuSubPopup>
          <MenuItem onClick={() => props.onMove(into)}>
            <MenuItemLabel>{t("browser.bookmarks.moveHere", { title })}</MenuItemLabel>
          </MenuItem>
          <MenuSeparator />
          <MoveTargets {...props} nodes={node.children} />
        </MenuSubPopup>
      </MenuSub>
    );
  });
}
