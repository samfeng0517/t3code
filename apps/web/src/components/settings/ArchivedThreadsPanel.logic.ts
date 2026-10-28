import type { OrchestrationV2ThreadArchivedBy } from "@t3tools/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * When the server will delete an archived thread. Only threads it archived
 * itself are ever deleted, so a manual archive never gets a date.
 */
export function archivedThreadAutoDeleteAt(
  thread: {
    readonly archivedAt: string | null;
    readonly archivedBy?: OrchestrationV2ThreadArchivedBy | null;
  },
  autoDeleteAfterDays: number | null,
): string | null {
  if (thread.archivedBy !== "auto" || thread.archivedAt === null || autoDeleteAfterDays === null) {
    return null;
  }
  const archivedAtMs = Date.parse(thread.archivedAt);
  if (Number.isNaN(archivedAtMs)) return null;
  return new Date(archivedAtMs + autoDeleteAfterDays * DAY_MS).toISOString();
}
