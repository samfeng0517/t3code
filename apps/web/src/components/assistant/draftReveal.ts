import type { ThreadId } from "@t3tools/contracts";

/** The clock bar's chip asks the assistant thread's timeline to scroll to its latest draft card. */
const listenersByThread = new Map<ThreadId, Set<() => void>>();

export function requestDraftReveal(threadId: ThreadId): void {
  for (const listener of listenersByThread.get(threadId) ?? []) listener();
}

export function subscribeDraftReveal(threadId: ThreadId, listener: () => void): () => void {
  let listeners = listenersByThread.get(threadId);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByThread.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listenersByThread.get(threadId) === listeners) {
      listenersByThread.delete(threadId);
    }
  };
}
