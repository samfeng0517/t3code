import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

import { useComposerDraftStore } from "~/composerDraftStore";

import { MarkdownCommentSurface } from "./MarkdownCommentSurface";
import { usePageCommentStore } from "./pageCommentStore";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-page-comments"),
  threadId: ThreadId.make("thread-page-comments"),
};

const SOURCE = "# Plan\n\nRead [the pricing page](#pricing) first.\n\nBilled yearly per seat.\n";

function setup(): Disposable {
  const reset = () => {
    useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
    usePageCommentStore.setState({ byTarget: {}, drafts: {} });
  };
  reset();
  return { [Symbol.dispose]: reset };
}

// Stands in for the rendered file: the same blocks and source-line marks the
// Markdown renderer gives a file preview, without its highlighter.
const surface = () => (
  <MarkdownCommentSurface threadRef={threadRef} relativePath="docs/plan.md" contents={SOURCE}>
    <div>
      <h1 data-source-line={1} data-source-line-end={1}>
        Plan
      </h1>
      <p data-source-line={3} data-source-line-end={3}>
        Read <a href="#pricing">the pricing page</a> first.
      </p>
      <p data-source-line={5} data-source-line-end={5}>
        Billed yearly per seat.
      </p>
    </div>
  </MarkdownCommentSurface>
);

const toggle = () => page.getByRole("button", { name: "Comment on page" });
const draftBox = () => page.getByRole("textbox");

async function writeComment(text: string) {
  await userEvent.fill(draftBox(), text);
  await userEvent.click(page.getByRole("button", { name: "Comment", exact: true }));
}

describe("Markdown page comments", () => {
  it("picks the clicked block instead of following its link", async () => {
    using _state = setup();
    await using screen = await render(surface());
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole("link", { name: "the pricing page" }));

    expect(window.location.hash).not.toBe("#pricing");
    await expect
      .element(draftBox())
      .toHaveAccessibleName(/L3 · <p> “Read the pricing page first\.”/);
    await writeComment("Link the 2026 prices");

    await expect.element(screen.getByText("Link the 2026 prices")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Comment 1" })).toBeVisible();
  });

  it("anchors to selected text", async () => {
    using _state = setup();
    await using screen = await render(surface());
    await userEvent.click(toggle());
    const paragraph = screen.getByText("Billed yearly per seat.").element();
    const text = paragraph.firstChild!;
    await act(() => {
      const range = document.createRange();
      range.setStart(text, "Billed ".length);
      range.setEnd(text, "Billed yearly".length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      // A real drag ends in a click on the block; replaying it keeps the selection.
      paragraph.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await expect.element(draftBox()).toHaveAccessibleName(/L5 · “yearly”/);
  });

  it("cancels only the draft on Escape in it, then leaves comment mode on the next Escape", async () => {
    using _state = setup();
    await using screen = await render(surface());
    await userEvent.click(toggle());
    await userEvent.click(screen.getByText("Billed yearly per seat."));
    await userEvent.type(draftBox(), "Half-written");
    await userEvent.keyboard("{Escape}");

    await expect.element(draftBox()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Stop commenting" }))
      .toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Escape}");
    await expect.element(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("sends each comment once, marks it sent, and queues it again after an edit", async () => {
    using _state = setup();
    await using screen = await render(surface());
    await userEvent.click(toggle());
    await userEvent.click(screen.getByText("Billed yearly per seat."));
    await writeComment("Say monthly");
    const send = page.getByRole("button", { name: "Send to agent" });
    await userEvent.click(send);

    await expect.element(screen.getByText("Sent", { exact: true })).toBeVisible();
    await expect.element(send).toBeDisabled();
    const reviewComments = () =>
      useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [];
    expect(reviewComments()).toEqual([
      expect.objectContaining({
        filePath: "docs/plan.md",
        rangeLabel: "L5",
        diff: "Billed yearly per seat.",
        text: "Say monthly",
      }),
    ]);

    await userEvent.click(page.getByRole("button", { name: "Edit comment" }));
    await userEvent.fill(draftBox(), "Say monthly, billed yearly");
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    await expect.element(screen.getByText("Sent", { exact: true })).not.toBeInTheDocument();
    await expect.element(send).toBeEnabled();
    await userEvent.click(send);
    await vi.waitFor(() =>
      expect(reviewComments()).toEqual([
        expect.objectContaining({ text: "Say monthly, billed yearly" }),
      ]),
    );
  });
});
