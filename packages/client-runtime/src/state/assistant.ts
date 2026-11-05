import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createAssistantEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // ERP must never be polled: every read after the first is an explicit refresh
  // (page entry, window focus, a clocking), so these never go stale on their own.
  const clockStatus = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:assistant:clock-status",
    tag: WS_METHODS.assistantGetClockStatus,
    staleTimeMs: Number.POSITIVE_INFINITY,
  });
  const dailyReport = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:assistant:daily-report",
    tag: WS_METHODS.assistantGetDailyReport,
    staleTimeMs: Number.POSITIVE_INFINITY,
  });
  const refreshClockStatus = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(clockStatus({ environmentId, input: {} })));
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:assistant:state",
      tag: WS_METHODS.assistantSubscribeState,
    }),
    clockStatus,
    dailyReport,
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:assistant:projects",
      tag: WS_METHODS.assistantListProjects,
      staleTimeMs: 5 * 60_000,
    }),
    clockIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:clock-in",
      tag: WS_METHODS.assistantClockIn,
      onSuccess: refreshClockStatus,
    }),
    clockOut: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:clock-out",
      tag: WS_METHODS.assistantClockOut,
      onSuccess: refreshClockStatus,
    }),
    saveDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:save-draft",
      tag: WS_METHODS.assistantSaveDraft,
    }),
    regenerateDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:regenerate-draft",
      tag: WS_METHODS.assistantRegenerateDraft,
    }),
    submitDailyReport: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:submit-daily-report",
      tag: WS_METHODS.assistantSubmitDailyReport,
    }),
    getOrCreateThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:get-or-create-thread",
      tag: WS_METHODS.assistantGetOrCreateThread,
    }),
    readMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:read-memory",
      tag: WS_METHODS.assistantReadMemory,
    }),
    writeMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:assistant:write-memory",
      tag: WS_METHODS.assistantWriteMemory,
    }),
  };
}
