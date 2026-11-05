import type { AssistantDailyReportStatus, AssistantDraft } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { cardMode } from "./dailyReportDraftCard.logic";

const draft: AssistantDraft = {
  reportDate: "2026-11-05",
  status: "ready",
  items: [],
  problemText: "",
  revision: 4,
  version: 2,
  sources: [],
  editedByUser: false,
  triggerAttempt: 0,
  updatedAt: "2026-11-05T01:30:00.000Z",
};

const report: AssistantDailyReportStatus = {
  reportDate: "2026-11-05",
  exempt: false,
  submittedAt: null,
  erpDailyReportUrl: "https://erp.example.com/daily-reports",
};

const card = { version: 2, reportDate: "2026-11-05", draft, report, canOperate: true };

describe("cardMode", () => {
  it("cardMode should return superseded when a newer version exists", () => {
    expect(cardMode({ ...card, draft: { ...draft, version: 3 } })).toBe("superseded");
    expect(cardMode({ ...card, draft: null })).toBe("superseded");
    expect(cardMode({ ...card, reportDate: "2026-11-04" })).toBe("superseded");
    expect(cardMode(card)).toBe("editable");
  });

  it("cardMode should return submitted when ERP reports submittedAt", () => {
    expect(
      cardMode({ ...card, report: { ...report, submittedAt: "2026-11-05T02:34:00.000Z" } }),
    ).toBe("submitted");
    // Another day's submission says nothing about this card.
    expect(
      cardMode({
        ...card,
        report: { ...report, reportDate: "2026-11-04", submittedAt: "2026-11-04T02:34:00.000Z" },
      }),
    ).toBe("editable");
    expect(cardMode({ ...card, canOperate: false })).toBe("readonly");
    expect(cardMode({ ...card, draft: { ...draft, status: "generating" } })).toBe("readonly");
  });
});
