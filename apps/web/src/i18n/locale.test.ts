import { describe, expect, it } from "vite-plus/test";

import { formatMessage, resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("honors an explicit preference over the navigator", () => {
    expect(resolveLocale("zh-TW", ["en-US"])).toBe("zh-TW");
    expect(resolveLocale("en", ["zh-TW"])).toBe("en");
  });

  it("maps Traditional Chinese navigator tags to zh-TW", () => {
    expect(resolveLocale("system", ["zh-TW"])).toBe("zh-TW");
    expect(resolveLocale("system", ["zh-Hant-TW", "en"])).toBe("zh-TW");
    expect(resolveLocale("system", ["zh-HK"])).toBe("zh-TW");
    expect(resolveLocale("system", ["ZH-hant"])).toBe("zh-TW");
  });

  it("falls back to English for unsupported or Simplified tags", () => {
    expect(resolveLocale("system", ["zh-CN", "zh-Hans"])).toBe("en");
    expect(resolveLocale("system", ["ja-JP"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
  });

  it("takes the first supported tag in navigator order", () => {
    expect(resolveLocale("system", ["ja", "zh-TW", "en"])).toBe("zh-TW");
    expect(resolveLocale("system", ["ja", "en-GB", "zh-TW"])).toBe("en");
  });
});

describe("formatMessage", () => {
  it("interpolates named params and leaves unknown placeholders alone", () => {
    expect(formatMessage("Saved on {count} environments", { count: 3 })).toBe(
      "Saved on 3 environments",
    );
    expect(formatMessage("Hello {name}, {missing}", { name: "Sam" })).toBe("Hello Sam, {missing}");
    expect(formatMessage("No params")).toBe("No params");
  });
});
