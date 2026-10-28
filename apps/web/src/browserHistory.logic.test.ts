import { describe, expect, it } from "vite-plus/test";

import {
  type BrowserHistoryEntry,
  hideTopSiteKey,
  historyVisitKey,
  mergeHistoryAcrossProjects,
  selectMostVisited,
} from "./browserHistory.logic";

const entry = (url: string, lastVisitedAt: number, extra: Partial<BrowserHistoryEntry> = {}) => ({
  url,
  lastVisitedAt,
  ...extra,
});

describe("mergeHistoryAcrossProjects", () => {
  it("should merge the same page across projects when listing global history", () => {
    const merged = mergeHistoryAcrossProjects({
      "proj-a": [entry("https://a.test/", 30, { visitCount: 2 }), entry("https://b.test/", 10)],
      "proj-b": [
        entry("https://c.test/", 20, { title: "C" }),
        entry("https://a.test/", 5, { title: "Old A", visitCount: 3 }),
      ],
      "browser-workspace": [entry("http://127.0.0.1:3000/", 25)],
    });
    expect(merged).toEqual([
      { url: "https://a.test/", lastVisitedAt: 30, visitCount: 5, title: "Old A" },
      { url: "http://127.0.0.1:3000/", lastVisitedAt: 25 },
      { url: "https://c.test/", lastVisitedAt: 20, title: "C" },
      { url: "https://b.test/", lastVisitedAt: 10 },
    ]);
  });

  it("should treat loopback aliases as one page when merging", () => {
    const merged = mergeHistoryAcrossProjects({
      a: [entry("http://localhost:5173/app", 2)],
      b: [entry("http://127.0.0.1:5173/app", 1)],
    });
    expect(merged).toEqual([{ url: "http://localhost:5173/app", lastVisitedAt: 2, visitCount: 2 }]);
  });

  it("should reuse unchanged entries from the previous merge when another project changes", () => {
    const shared = entry("https://a.test/", 30);
    const first = mergeHistoryAcrossProjects({ a: [shared], b: [entry("https://b.test/", 10)] });
    const second = mergeHistoryAcrossProjects(
      { a: [shared], b: [entry("https://b.test/", 10, { title: "B" })] },
      first,
    );
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });
});

describe("selectMostVisited", () => {
  const merged = [
    entry("https://recent.test/", 50),
    entry("https://often.test/", 10, { visitCount: 9 }),
    entry("https://tie-new.test/", 40, { visitCount: 3 }),
    entry("https://tie-old.test/", 30, { visitCount: 3 }),
  ];

  it("should order by visit count and break ties by recency", () => {
    expect(selectMostVisited(merged, [], 3).map((item) => item.url)).toEqual([
      "https://often.test/",
      "https://tie-new.test/",
      "https://tie-old.test/",
    ]);
  });

  it("should leave out hidden sites when a most visited link was removed", () => {
    const hidden = hideTopSiteKey([], "https://often.test/");
    expect(selectMostVisited(merged, hidden, 8).map((item) => item.url)).toEqual([
      "https://tie-new.test/",
      "https://tie-old.test/",
      "https://recent.test/",
    ]);
  });

  it("should keep the hidden list bounded and free of duplicates", () => {
    let hidden: string[] = [];
    for (let index = 0; index < 150; index += 1)
      hidden = hideTopSiteKey(hidden, `https://s${index}.test/`);
    hidden = hideTopSiteKey(hidden, "https://s149.test/");
    expect(hidden).toHaveLength(100);
    expect(hidden.at(-1)).toBe(historyVisitKey("https://s149.test/"));
    expect(hidden.filter((key) => key === historyVisitKey("https://s149.test/"))).toHaveLength(1);
  });
});
