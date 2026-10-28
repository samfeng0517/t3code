import { useSyncExternalStore } from "react";

import { getLanguagePreference, subscribeLanguagePreference } from "./languagePreferenceStore";
import { formatMessage, resolveLocale, type Locale, type MessageParams } from "./locale";
import { en, type MessageKey } from "./messages/en";
import { zhTW } from "./messages/zh-TW";

export type { MessageKey } from "./messages/en";

const MESSAGES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  en,
  "zh-TW": zhTW,
};

export type Translate = (key: MessageKey, params?: MessageParams) => string;

function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return formatMessage(MESSAGES[locale][key] ?? en[key], params);
}

function readNavigatorLanguages(): ReadonlyArray<string> {
  if (typeof navigator === "undefined") return [];
  return navigator.languages ?? [navigator.language];
}

// Snapshot must be a primitive so React can compare it by value between renders.
function readNavigatorLanguageKey(): string {
  return readNavigatorLanguages().join(",");
}

function subscribeNavigatorLanguage(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("languagechange", listener);
  return () => window.removeEventListener("languagechange", listener);
}

export function useLocale(): Locale {
  const preference = useSyncExternalStore(
    subscribeLanguagePreference,
    getLanguagePreference,
    getLanguagePreference,
  );
  const navigatorLanguageKey = useSyncExternalStore(
    subscribeNavigatorLanguage,
    readNavigatorLanguageKey,
    () => "",
  );
  return resolveLocale(preference, navigatorLanguageKey ? navigatorLanguageKey.split(",") : []);
}

export function useT(): Translate {
  const locale = useLocale();
  return (key, params) => translate(locale, key, params);
}

/** For code outside React. Components use `useT` so they re-render on change. */
export function getLocale(): Locale {
  return resolveLocale(getLanguagePreference(), readNavigatorLanguages());
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(getLocale(), key, params);
}
