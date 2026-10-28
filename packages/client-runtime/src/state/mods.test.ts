import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { applyModSurfaceFrame, EMPTY_MOD_SURFACE_VIEW, lastRaisedModToast } from "./mods.ts";

const PANE = { id: "demo-pane", title: "Demo pane", plugin: "demo" };
const TOAST = { id: "t1", plugin: "demo", text: "saved", timeoutMs: 4000 };

describe("applyModSurfaceFrame", () => {
  it("starts from the snapshot, then follows the thread's changes", () => {
    const view = [
      {
        type: "snapshot",
        state: {
          availability: "available",
          panes: [{ ...PANE, tree: null }],
          band: null,
          statuses: [],
        },
      },
      { type: "pane-tree", paneId: "demo-pane", tree: { type: "markdown", text: "**hi**" } },
      { type: "status", plugin: "demo", text: "watching 3 files" },
      { type: "toast", toast: TOAST },
    ] as const;
    expect(view.reduce(applyModSurfaceFrame, EMPTY_MOD_SURFACE_VIEW)).toEqual({
      availability: "available",
      panes: [{ ...PANE, tree: { type: "markdown", text: "**hi**" } }],
      band: null,
      statuses: [{ plugin: "demo", text: "watching 3 files" }],
      toasts: [TOAST],
    });
  });

  it("forgets everything the process drew when it ends", () => {
    const live = applyModSurfaceFrame(
      applyModSurfaceFrame(EMPTY_MOD_SURFACE_VIEW, { type: "panes", panes: [PANE] }),
      { type: "toast", toast: TOAST },
    );
    expect(applyModSurfaceFrame(live, { type: "reset", availability: "inactive" })).toEqual(
      EMPTY_MOD_SURFACE_VIEW,
    );
  });

  it("keeps the same view when a change names a pane that is not open", () => {
    const view = applyModSurfaceFrame(EMPTY_MOD_SURFACE_VIEW, { type: "panes", panes: [PANE] });
    expect(
      applyModSurfaceFrame(view, {
        type: "pane-tree",
        paneId: "closed",
        tree: { type: "markdown", text: "late" },
      }),
    ).toBe(view);
  });

  it("keeps only the newest toasts", () => {
    let view = EMPTY_MOD_SURFACE_VIEW;
    for (let index = 0; index < 25; index++) {
      view = applyModSurfaceFrame(view, { type: "toast", toast: { ...TOAST, id: `t${index}` } });
    }
    expect(view.toasts.map((toast) => toast.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `t${index + 5}`),
    );
  });
});

describe("lastRaisedModToast", () => {
  it("remembers each thread's last raised toast with no view mounted", () => {
    const registry = AtomRegistry.make();
    const environmentId = EnvironmentId.make("environment-mods");
    const threadId = ThreadId.make("thread-mods");
    registry.set(lastRaisedModToast(environmentId, threadId), "t1");

    expect(registry.get(lastRaisedModToast(environmentId, threadId))).toBe("t1");
    expect(registry.get(lastRaisedModToast(environmentId, ThreadId.make("other")))).toBeNull();
    expect(
      registry.get(lastRaisedModToast(EnvironmentId.make("other-environment"), threadId)),
    ).toBeNull();
  });
});
