import type { LanguagePreference } from "@t3tools/contracts";

// Kept apart from the client settings store so `~/i18n` stays dependency-free:
// components deep in the composer import it, and pulling `hooks/useSettings`
// (toast, utils, atoms) in from there closes an import cycle.
let preference: LanguagePreference = "system";
const listeners = new Set<() => void>();

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

export function setLanguagePreference(next: LanguagePreference): void {
  if (next === preference) return;
  preference = next;
  for (const listener of listeners) listener();
}

export function subscribeLanguagePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
