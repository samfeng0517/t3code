import { useState } from "react";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import type { BrowserWorkspaceTab } from "~/browserWorkspace.logic";
import { useBrowserWorkspaceStore } from "~/browserWorkspaceStore";
import { SidebarBrowserTabList } from "./SidebarBrowserSection";
import { deriveSidebarBrowserTabs } from "./sidebarBrowserTabs.logic";

const tab = (id: string, title: string, pinned = false): BrowserWorkspaceTab => ({
  id,
  url: `https://${id}.example/`,
  title,
  pinned,
  sessionTabId: null,
});

function setup() {
  const previous = useBrowserWorkspaceStore.getState();
  useBrowserWorkspaceStore.setState({
    tabs: [tab("p", "Docs", true), tab("a", "Alpha"), tab("b", "Beta"), tab("c", "Gamma")],
    activeTabId: "a",
  });
  return {
    [Symbol.dispose]: () =>
      useBrowserWorkspaceStore.setState({ tabs: previous.tabs, activeTabId: previous.activeTabId }),
  };
}

function TabList(props: { readonly onActivate: (tab: BrowserWorkspaceTab) => void }) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const tabs = useBrowserWorkspaceStore((state) => state.tabs);
  const activeTabId = useBrowserWorkspaceStore((state) => state.activeTabId);
  const rows = deriveSidebarBrowserTabs({
    tabs,
    activeTabId,
    workspaceShown: true,
    sessions: {},
    desktopByTabId: {},
  });
  return (
    <SidebarBrowserTabList
      tabs={rows}
      onActivate={props.onActivate}
      onClose={() => {}}
      onUnpin={() => {}}
      onContextMenu={() => {}}
      renamingTabId={renamingTabId}
      onStartRename={(renamed) => setRenamingTabId(renamed.id)}
      onFinishRename={(renamed, name) => {
        setRenamingTabId(null);
        if (name !== null) useBrowserWorkspaceStore.getState().renameTab(renamed.id, name);
      }}
    />
  );
}

function pointer(type: string, target: Element, offsetY = 0) {
  const rect = target.getBoundingClientRect();
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 1,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2 + offsetY,
  });
}

const workspaceOrder = () => useBrowserWorkspaceStore.getState().tabs.map((entry) => entry.id);

describe("SidebarBrowserTabList", () => {
  it("should reorder the workspace's tabs when a tab is dragged onto another unpinned tab", async () => {
    using _store = setup();
    const onActivate = vi.fn();
    await using screen = await render(<TabList onActivate={onActivate} />);
    const gamma = screen.getByRole("button", { name: "Gamma" }).element();
    const alpha = screen.getByRole("button", { name: "Alpha" }).element();
    const alphaRow = alpha.closest("li")!;

    gamma.dispatchEvent(pointer("pointerdown", gamma));
    document.dispatchEvent(pointer("pointermove", gamma, -10));
    document.dispatchEvent(pointer("pointermove", alpha, -4));
    // The rows the drag passes over slide aside once dnd-kit has measured them.
    await vi.waitFor(() => expect(alphaRow.style.transform).not.toBe(""));
    document.dispatchEvent(pointer("pointerup", alpha, -4));

    expect(workspaceOrder()).toEqual(["p", "c", "a", "b"]);
    await expect.element(screen.getByRole("list")).toHaveTextContent("DocsGammaAlphaBeta");
    await screen.getByRole("button", { name: "Beta" }).click();
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "b" }));
  });

  it("should save the typed name when a tab is double-clicked, renamed and confirmed with Enter", async () => {
    using _store = setup();
    await using screen = await render(<TabList onActivate={() => {}} />);

    await screen.getByRole("button", { name: "Alpha" }).dblClick();
    const input = screen.getByRole("textbox", { name: "Tab name" });
    await userEvent.fill(input, "Inbox");
    await userEvent.keyboard("{Enter}");

    expect(
      useBrowserWorkspaceStore.getState().tabs.find((entry) => entry.id === "a"),
    ).toMatchObject({ customTitle: "Inbox" });
    await expect.element(screen.getByRole("button", { name: "Inbox" })).toBeVisible();
  });

  it("should keep the old name when a rename is cancelled with Escape", async () => {
    using _store = setup();
    await using screen = await render(<TabList onActivate={() => {}} />);

    await screen.getByRole("button", { name: "Alpha" }).dblClick();
    await userEvent.fill(screen.getByRole("textbox", { name: "Tab name" }), "Inbox");
    await userEvent.keyboard("{Escape}");

    await expect.element(screen.getByRole("button", { name: "Alpha" })).toBeVisible();
    expect(
      useBrowserWorkspaceStore.getState().tabs.find((entry) => entry.id === "a")?.customTitle,
    ).toBeUndefined();
  });

  it("should keep following the page title when a rename is confirmed without changing the name", async () => {
    using _store = setup();
    await using screen = await render(<TabList onActivate={() => {}} />);

    await screen.getByRole("button", { name: "Alpha" }).dblClick();
    await expect.element(screen.getByRole("textbox", { name: "Tab name" })).toHaveValue("Alpha");
    await userEvent.keyboard("{Enter}");

    await expect.element(screen.getByRole("button", { name: "Alpha" })).toBeVisible();
    expect(
      useBrowserWorkspaceStore.getState().tabs.find((entry) => entry.id === "a")?.customTitle,
    ).toBeUndefined();
  });

  it("should offer unpinning instead of closing when a tab is pinned", async () => {
    using _store = setup();
    await using screen = await render(<TabList onActivate={() => {}} />);

    await expect.element(screen.getByRole("button", { name: "Unpin Docs" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Close Docs" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Close Alpha" })).toBeInTheDocument();
  });
});
