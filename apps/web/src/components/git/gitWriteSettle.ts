import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

/**
 * Turns a rejecting or throwing write into a `Failure`, so the caller's lock release after the
 * `await` always runs. `try`/`finally` would make React Compiler skip the hook.
 */
export function settleGitWrite<T>(
  action: () => Promise<AtomCommandResult<T, unknown>>,
): Promise<AtomCommandResult<T, unknown>> {
  return Promise.resolve()
    .then(action)
    .catch((defect: unknown) => AsyncResult.failure(Cause.die(defect)));
}

/**
 * Settles a write, then refreshes the page unless it was interrupted. Failed writes refresh too:
 * a pull fetches before its merge is refused, and a create-and-switch keeps the new branch when
 * the switch fails. `awaitRefresh` resolves only once the page shows the write's result.
 */
export async function settleGitWriteAndRefresh<T>(
  action: () => Promise<AtomCommandResult<T, unknown>>,
  refresh: () => Promise<void>,
  options?: { readonly awaitRefresh?: boolean },
): Promise<AtomCommandResult<T, unknown>> {
  const result = await settleGitWrite(action);
  if (isAtomCommandInterrupted(result)) return result;
  if (options?.awaitRefresh === true) await refresh();
  else void refresh();
  return result;
}
