import { createAssistantEnvironmentAtoms } from "@t3tools/client-runtime/state/assistant";
import type { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const assistantEnvironment = createAssistantEnvironmentAtoms(connectionAtomRuntime);

/** Refetches a query that already settled; one still loading is fresh enough. */
export function refreshSettled<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  const current = registry.get(atom);
  if (current._tag !== "Initial" && !current.waiting) registry.refresh(atom);
}
