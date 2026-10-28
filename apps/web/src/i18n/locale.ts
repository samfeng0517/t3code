import type { LanguagePreference } from "@t3tools/contracts";

export type Locale = "en" | "zh-TW";

const DEFAULT_LOCALE: Locale = "en";

// Any Traditional-script Chinese tag (zh-TW, zh-HK, zh-MO, zh-Hant-*) reads the
// zh-TW bundle; Simplified tags fall through to English rather than to a script
// the reader did not ask for.
function localeFromLanguageTag(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase();
  if (!normalized.startsWith("zh")) return normalized.startsWith("en") ? "en" : null;
  const parts = normalized.split("-");
  if (
    parts.includes("hant") ||
    parts.includes("tw") ||
    parts.includes("hk") ||
    parts.includes("mo")
  ) {
    return "zh-TW";
  }
  return null;
}

export function resolveLocale(
  preference: LanguagePreference,
  navigatorLanguages: ReadonlyArray<string>,
): Locale {
  if (preference !== "system") return preference;
  for (const tag of navigatorLanguages) {
    const locale = localeFromLanguageTag(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export type MessageParams = Readonly<Record<string, string | number>>;

export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
