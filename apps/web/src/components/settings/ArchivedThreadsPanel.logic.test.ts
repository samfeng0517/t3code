import { describe, expect, it } from "vite-plus/test";

import { archivedThreadAutoDeleteAt } from "./ArchivedThreadsPanel.logic";

const archivedAt = "2026-10-01T08:00:00.000Z";

describe("archivedThreadAutoDeleteAt", () => {
  it("should add the configured days when the server archived the thread", () => {
    expect(archivedThreadAutoDeleteAt({ archivedAt, archivedBy: "auto" }, 30)).toBe(
      "2026-10-31T08:00:00.000Z",
    );
  });

  it("should return null when the user archived the thread or it predates the field", () => {
    expect(archivedThreadAutoDeleteAt({ archivedAt, archivedBy: "user" }, 30)).toBeNull();
    expect(archivedThreadAutoDeleteAt({ archivedAt }, 30)).toBeNull();
  });

  it("should return null when automatic deletion is off", () => {
    expect(archivedThreadAutoDeleteAt({ archivedAt, archivedBy: "auto" }, null)).toBeNull();
  });
});
