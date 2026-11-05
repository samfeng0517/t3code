import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { requestDraftReveal, subscribeDraftReveal } from "./draftReveal";

describe("draftReveal", () => {
  it("requestDraftReveal should reach a later subscriber when an emptied earlier subscription is disposed again", () => {
    const threadId = ThreadId.make("thread-assistant");
    const other = vi.fn();
    const early = subscribeDraftReveal(threadId, vi.fn());
    early();
    const later = vi.fn();
    using _later = { [Symbol.dispose]: subscribeDraftReveal(threadId, later) };
    using _other = { [Symbol.dispose]: subscribeDraftReveal(ThreadId.make("thread-other"), other) };
    early();

    requestDraftReveal(threadId);

    expect(later).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });
});
