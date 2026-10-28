import { isLocalLoopbackHost, normalizeHostname } from "./browser/browserTargetResolver";

/** `visitCount` is absent for a single visit, which keeps older saved history valid. */
export type BrowserHistoryEntry = {
  url: string;
  lastVisitedAt: number;
  title?: string;
  visitCount?: number;
};

export const BROWSER_HISTORY_MAX_HIDDEN_TOP_SITES = 100;

/**
 * Pages that differ only by which loopback alias (or the environment's own host) reached them
 * are the same visit.
 */
export function historyVisitKey(normalized: string, environmentHostname?: string | null): string {
  const parsed = new URL(normalized);
  const host = normalizeHostname(parsed.hostname);
  const environmentHost = environmentHostname && normalizeHostname(environmentHostname);
  if (isLocalLoopbackHost(host) || host === "0.0.0.0" || host === environmentHost)
    parsed.hostname = "local";
  return parsed.href;
}

const historyVisitCount = (entry: BrowserHistoryEntry): number => entry.visitCount ?? 1;

const sameEntry = (left: BrowserHistoryEntry, right: BrowserHistoryEntry) =>
  left.url === right.url &&
  left.lastVisitedAt === right.lastVisitedAt &&
  left.title === right.title &&
  left.visitCount === right.visitCount;

/**
 * One list across every project, newest first. Entries equal to one in `previous` are returned
 * as that same object, so a write to one project leaves other rows' identity alone.
 */
export function mergeHistoryAcrossProjects(
  byProjectKey: Readonly<Record<string, ReadonlyArray<BrowserHistoryEntry>>>,
  previous: ReadonlyArray<BrowserHistoryEntry> = [],
): BrowserHistoryEntry[] {
  const all = Object.values(byProjectKey)
    .flat()
    .toSorted((a, b) => b.lastVisitedAt - a.lastVisitedAt);
  const byKey = new Map<string, BrowserHistoryEntry>();
  for (const candidate of all) {
    const key = historyVisitKey(candidate.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const visitCount = historyVisitCount(existing) + historyVisitCount(candidate);
    const title = existing.title ?? candidate.title;
    byKey.set(key, {
      url: existing.url,
      lastVisitedAt: existing.lastVisitedAt,
      visitCount,
      ...(title === undefined ? {} : { title }),
    });
  }
  const previousByUrl = new Map(previous.map((item) => [item.url, item]));
  return [...byKey.values()].map((item) => {
    const prior = previousByUrl.get(item.url);
    return prior && sameEntry(prior, item) ? prior : item;
  });
}

export function selectMostVisited(
  merged: ReadonlyArray<BrowserHistoryEntry>,
  hiddenKeys: ReadonlyArray<string>,
  limit: number,
): BrowserHistoryEntry[] {
  const hidden = new Set(hiddenKeys);
  return merged
    .filter((item) => !hidden.has(historyVisitKey(item.url)))
    .toSorted(
      (a, b) => historyVisitCount(b) - historyVisitCount(a) || b.lastVisitedAt - a.lastVisitedAt,
    )
    .slice(0, limit);
}

/** Newest last, so the oldest hidden site is the first to come back once the list is full. */
export function hideTopSiteKey(hiddenKeys: ReadonlyArray<string>, url: string): string[] {
  const key = historyVisitKey(url);
  return [...hiddenKeys.filter((candidate) => candidate !== key), key].slice(
    -BROWSER_HISTORY_MAX_HIDDEN_TOP_SITES,
  );
}
