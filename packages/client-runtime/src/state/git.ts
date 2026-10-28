import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";
import { invalidateCachedVcsRefs } from "./vcsRefInvalidation.ts";

const COMMIT_QUERY_STALE_TIME_MS = 5 * 60_000;

// Tag writes change the ref list that thread-toolbar pickers render from.
const invalidateRefs = (
  target: { readonly environmentId: EnvironmentId; readonly input: { readonly cwd: string } },
  registry: AtomRegistry.AtomRegistry,
) =>
  invalidateCachedVcsRefs(registry, {
    environmentId: target.environmentId,
    cwd: target.input.cwd,
  });

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    historyLog: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:history-log",
      tag: WS_METHODS.gitHistoryLog,
    }),
    historyFingerprint: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:history-fingerprint",
      tag: WS_METHODS.gitHistoryFingerprint,
    }),
    historyRefs: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:history-refs",
      tag: WS_METHODS.gitHistoryRefs,
    }),
    commitDetail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:commit-detail",
      tag: WS_METHODS.gitCommitDetail,
      staleTimeMs: COMMIT_QUERY_STALE_TIME_MS,
    }),
    commitFileDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:commit-file-diff",
      tag: WS_METHODS.gitCommitFileDiff,
      staleTimeMs: COMMIT_QUERY_STALE_TIME_MS,
    }),
    createTag: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:create-tag",
      tag: WS_METHODS.gitCreateTag,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSettled: invalidateRefs,
    }),
    deleteTag: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:delete-tag",
      tag: WS_METHODS.gitDeleteTag,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSettled: invalidateRefs,
    }),
    pushTag: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:push-tag",
      tag: WS_METHODS.gitPushTag,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSettled: invalidateRefs,
    }),
  };
}
