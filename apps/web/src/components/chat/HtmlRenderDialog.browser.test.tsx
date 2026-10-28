import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});

import { pageCommentKey, usePageCommentStore } from "../pageComments/pageCommentStore";
import { HtmlRenderDialog } from "./HtmlRenderDialog";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-html-dialog"),
  threadId: ThreadId.make("thread-html-dialog"),
};
const target = { kind: "html-render", id: "attachment-1", title: "Chart" } as const;

function setup(): Disposable {
  const reset = () => usePageCommentStore.setState({ byTarget: {}, drafts: {} });
  reset();
  return { [Symbol.dispose]: reset };
}

// The dialog's inert backdrop sits over its content without the app's styles,
// so pointer clicks would land on it; these press the element directly.
const press = (name: string) =>
  act(async () => (page.getByRole("button", { name }).element() as HTMLElement).click());

const dialog = (onClose: () => void) => (
  <HtmlRenderDialog
    // An about:blank frame takes the test page down with it.
    src="data:text/html,%3Cp%3EChart%3C/p%3E"
    title="Chart"
    threadRef={threadRef}
    commentTarget={target}
    onClose={onClose}
  />
);

describe("full-screen page comments", () => {
  it("leaves comment mode on Escape before the next Escape closes the page", async () => {
    using _state = setup();
    const onClose = vi.fn();
    await using _screen = await render(dialog(onClose));
    await press("Comment on page");
    const stop = page.getByRole("button", { name: "Stop commenting" });
    await expect.element(stop).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("button", { name: "Comment on page" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("cancels a draft on Escape in it and keeps the page open", async () => {
    using _state = setup();
    usePageCommentStore.getState().setDraft(pageCommentKey(threadRef, target), {
      kind: "new",
      anchor: {
        kind: "region",
        selector: null,
        tagName: null,
        quote: null,
        box: { x: 10, y: 10, width: 20, height: 20 },
      },
      body: "Half-written",
    });
    const onClose = vi.fn();
    await using _screen = await render(dialog(onClose));
    const draft = page.getByRole("textbox");
    await expect.element(draft).toHaveValue("Half-written");
    await act(async () => (draft.element() as HTMLTextAreaElement).focus());

    await userEvent.keyboard("{Escape}");
    await expect.element(draft).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
