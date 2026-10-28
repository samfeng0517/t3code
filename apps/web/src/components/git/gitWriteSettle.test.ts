import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { settleGitWrite, settleGitWriteAndRefresh } from "./gitWriteSettle";

describe("settleGitWrite", () => {
  it("should pass the action's result through when the action settles", async () => {
    const settled = AsyncResult.success(3);
    const result = await settleGitWrite(async () => settled);
    expect(result).toBe(settled);
  });

  it("should resolve to a failure carrying the error when the action rejects", async () => {
    const error = new Error("socket closed");
    const result = await settleGitWrite(() => Promise.reject(error));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(squashAtomCommandFailure(result)).toBe(error);
  });

  it("should resolve to a failure carrying the error when the action throws synchronously", async () => {
    const error = new Error("bad input");
    const result = await settleGitWrite(() => {
      throw error;
    });
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(squashAtomCommandFailure(result)).toBe(error);
  });
});

describe("settleGitWriteAndRefresh", () => {
  it("should refresh when the write succeeds", async () => {
    const refresh = vi.fn(async () => {});
    await settleGitWriteAndRefresh(async () => AsyncResult.success(1), refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("should refresh when the write fails after changing the repo", async () => {
    const refresh = vi.fn(async () => {});
    const result = await settleGitWriteAndRefresh(
      async () => AsyncResult.failure(Cause.fail(new Error("checkout refused"))),
      refresh,
    );
    expect(result._tag).toBe("Failure");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("should not refresh when the write was interrupted", async () => {
    const refresh = vi.fn(async () => {});
    await settleGitWriteAndRefresh(async () => AsyncResult.failure(Cause.interrupt()), refresh);
    expect(refresh).not.toHaveBeenCalled();
  });
});
