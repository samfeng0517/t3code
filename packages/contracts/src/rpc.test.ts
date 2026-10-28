import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
} from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("WebSocket RPC contracts", () => {
  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });

  it("registers vcs.fetch for a repository folder", () => {
    const fetch = WsRpcGroup.requests.get(WS_METHODS.vcsFetch);
    if (fetch === undefined) throw new Error("vcs.fetch is not registered");
    const decode = Schema.decodeUnknownExit(fetch.payloadSchema);

    expect(Exit.isSuccess(decode({ cwd: "/repo" }))).toBe(true);
    expect(Exit.isFailure(decode({ cwd: " " }))).toBe(true);
  });

  it("keeps an existing-branch worktree launch through a persisted round trip", () => {
    const codec = Schema.fromJsonString(OrchestrationV2ThreadLaunchWorkspaceStrategy);
    const strategy = {
      type: "worktree",
      baseRef: "origin/feature-x",
      existingBranch: true,
    } as const;

    expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(strategy))).toEqual(strategy);
  });
});
