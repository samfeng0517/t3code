import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "../../closedViewStore";
import { GIT_PAGE_REF, type GitTab, gitTabKey, useGitTabsStore } from "./gitTabsStore";

const tab = (projectId: string): GitTab => ({
  environmentId: EnvironmentId.make("env-1"),
  projectId: ProjectId.make(projectId),
});

beforeEach(() => {
  useGitTabsStore.setState({ tabs: [], activeKey: null });
  useClosedViewStore.setState({ entries: [] });
});

describe("gitTabsStore", () => {
  it("open should activate the existing tab when the project is already open", () => {
    const store = useGitTabsStore.getState();
    store.open(tab("a"));
    store.open(tab("b"));
    store.open(tab("a"));
    const state = useGitTabsStore.getState();
    expect(state.tabs).toEqual([tab("a"), tab("b")]);
    expect(state.activeKey).toBe(gitTabKey(tab("a")));
  });

  it("close should activate the right neighbor and remember a git-tab closed view when a middle tab closes", () => {
    const store = useGitTabsStore.getState();
    store.open(tab("a"));
    store.open(tab("b"));
    store.open(tab("c"));
    store.activate(gitTabKey(tab("b")));
    store.close(gitTabKey(tab("b")));
    const state = useGitTabsStore.getState();
    expect(state.tabs).toEqual([tab("a"), tab("c")]);
    expect(state.activeKey).toBe(gitTabKey(tab("c")));
    expect(useClosedViewStore.getState().entries).toEqual([
      expect.objectContaining({
        kind: "git-tab",
        threadRef: GIT_PAGE_REF,
        environmentId: "env-1",
        projectId: "b",
      }),
    ]);
  });

  it("close should activate the left neighbor when the last tab closes", () => {
    const store = useGitTabsStore.getState();
    store.open(tab("a"));
    store.open(tab("b"));
    store.close(gitTabKey(tab("b")));
    expect(useGitTabsStore.getState().activeKey).toBe(gitTabKey(tab("a")));
    store.close(gitTabKey(tab("a")));
    expect(useGitTabsStore.getState()).toMatchObject({ tabs: [], activeKey: null });
  });

  it("close should keep the active tab when an inactive tab closes", () => {
    const store = useGitTabsStore.getState();
    store.open(tab("a"));
    store.open(tab("b"));
    store.close(gitTabKey(tab("a")));
    expect(useGitTabsStore.getState().activeKey).toBe(gitTabKey(tab("b")));
  });

  it("should drop malformed tabs and activate the first tab when rehydrating saved tabs with a dangling active key", async () => {
    const { storage, name } = useGitTabsStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: {
        tabs: [tab("a"), { environmentId: "env-1" }, null],
        activeKey: "env-1:missing",
      },
      version: 1,
    });
    await useGitTabsStore.persist.rehydrate();
    expect(useGitTabsStore.getState()).toMatchObject({
      tabs: [tab("a")],
      activeKey: gitTabKey(tab("a")),
    });
  });
});
