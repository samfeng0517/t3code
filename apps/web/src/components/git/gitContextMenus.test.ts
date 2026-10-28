import { describe, expect, it } from "vite-plus/test";

import { buildGitMenu } from "./gitContextMenus";

const HASH = "a".repeat(40);

const context = {
  canWrite: true,
  isOnline: true,
  pending: false,
  inUseBy: null,
  isCurrentBranch: false,
  isRemoteDefaultBranch: false,
  remoteNames: ["origin"],
};

describe("buildGitMenu", () => {
  it("buildGitMenu should list only Copy commit hash when the connection lacks write permission", () => {
    for (const target of [
      { kind: "commit", hash: HASH },
      { kind: "local", name: "main", hash: HASH },
      { kind: "remote", fullName: "origin/main", hash: HASH },
      { kind: "tag", name: "v1", hash: HASH },
    ] as const) {
      const items = buildGitMenu(target, { ...context, canWrite: false });
      expect(items.map((item) => item.id)).toEqual(["copy-hash"]);
    }
  });

  it("buildGitMenu should list the commit actions with a short hash when the target is a commit", () => {
    const items = buildGitMenu({ kind: "commit", hash: HASH }, context);
    expect(items.map((item) => item.id)).toEqual([
      "checkout",
      "create-branch",
      "create-tag",
      "copy-hash",
    ]);
    expect(items[0]?.label).toBe("Checkout aaaaaaa");
    expect(items[3]?.separatorBefore).toBe(true);
  });

  it("buildGitMenu should disable Rename and Delete and add the reason when a thread uses the branch", () => {
    const items = buildGitMenu(
      { kind: "local", name: "fix/login", hash: HASH },
      { ...context, inUseBy: "Fix login redirect" },
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get("checkout")?.disabled).toBeFalsy();
    expect(byId.get("rename")?.disabled).toBe(true);
    expect(byId.get("delete")?.disabled).toBe(true);
    const last = items.at(-1);
    expect(last?.header).toBe(true);
    expect(last?.label).toBe('Thread "Fix login redirect" is using this branch');
  });

  it("buildGitMenu should disable Checkout and Delete when the branch is the current root branch", () => {
    const items = buildGitMenu(
      { kind: "local", name: "main", hash: HASH },
      { ...context, isCurrentBranch: true },
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get("checkout")?.disabled).toBe(true);
    expect(byId.get("rename")?.disabled).toBeFalsy();
    expect(byId.get("delete")?.disabled).toBe(true);
  });

  it("buildGitMenu should nest one Push tag entry per remote when there are several remotes", () => {
    const items = buildGitMenu(
      { kind: "tag", name: "v1", hash: HASH },
      { ...context, remoteNames: ["origin", "upstream"] },
    );
    const push = items[0];
    expect(push?.label).toBe("Push tag");
    expect(push?.children?.map((child) => [child.id, child.label])).toEqual([
      ["push-tag:origin", "origin"],
      ["push-tag:upstream", "upstream"],
    ]);
  });

  it("buildGitMenu should push to the only remote directly or disable Push tag when there is none", () => {
    const single = buildGitMenu({ kind: "tag", name: "v1", hash: HASH }, context);
    expect(single[0]?.id).toBe("push-tag:origin");
    expect(single[0]?.children).toBeUndefined();
    const none = buildGitMenu(
      { kind: "tag", name: "v1", hash: HASH },
      { ...context, remoteNames: [] },
    );
    expect(none[0]?.disabled).toBe(true);
  });

  it("buildGitMenu should disable write items but keep Copy commit hash when a write is pending or offline", () => {
    for (const state of [{ pending: true }, { isOnline: false }]) {
      const items = buildGitMenu(
        { kind: "remote", fullName: "origin/main", hash: HASH },
        {
          ...context,
          ...state,
        },
      );
      expect(items.map((item) => [item.id, item.disabled === true])).toEqual([
        ["checkout", true],
        ["delete", true],
        ["copy-hash", false],
      ]);
    }
  });

  it("buildGitMenu should offer a destructive Delete when the target is a remote branch", () => {
    const items = buildGitMenu({ kind: "remote", fullName: "origin/feature", hash: HASH }, context);
    expect(items.map((item) => item.id)).toEqual(["checkout", "delete", "copy-hash"]);
    const remove = items.find((item) => item.id === "delete");
    expect(remove?.destructive).toBe(true);
    expect(remove?.disabled).toBeFalsy();
  });

  it("buildGitMenu should disable Delete when the remote branch is its remote's default branch", () => {
    const items = buildGitMenu(
      { kind: "remote", fullName: "origin/main", hash: HASH },
      { ...context, isRemoteDefaultBranch: true },
    );
    expect(items.find((item) => item.id === "delete")?.disabled).toBe(true);
  });
});
