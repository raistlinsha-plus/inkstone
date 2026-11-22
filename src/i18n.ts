import english from "./locales/en.json";
import { useSyncExternalStore } from "react";

export type Language = "zh-CN" | "en";
export type LanguagePreference = Language | "system";

const preferenceKey = "inkstone:language";
const listeners = new Set<() => void>();
export const subscribeLocale = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function resolveLanguage(
  preference: LanguagePreference,
  languages: readonly string[],
): Language {
  if (preference !== "system") return preference;
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language);
      if (locale.language === "en") return "en";
      if (locale.language === "zh" && locale.maximize().script === "Hans")
        return "zh-CN";
    } catch {
      /* Skip invalid language tags. */
    }
  }
  return "en";
}

const systemLanguages = () =>
  navigator.languages?.length ? navigator.languages : [navigator.language];
export function systemRegion(): string {
  for (const tag of systemLanguages()) {
    try {
      return new Intl.Locale(tag).toString();
    } catch {
      /* Try the next region. */
    }
  }
  return "en";
}

let snapshot = {
  language: "zh-CN" as Language,
  preference: "system" as LanguagePreference,
  region: "zh-CN",
};
const current = () => snapshot;
// Source-language message IDs keep translated UI copy separate from document data.
export type Message = keyof typeof english;
export const msg = (key: Message) =>
  snapshot.language === "en" ? english[key] : key;
// Only localize recognized application messages. Other service diagnostics keep their original text.
export const systemMessage = (text: string) =>
  Object.hasOwn(english, text) ? msg(text as Message) : text;
export const translate = (zh: string, en: string) =>
  snapshot.language === "en" ? en : zh;
export function documentCount(count: number, removed = false) {
  const number = new Intl.NumberFormat(snapshot.region).format(count);
  return translate(
    `${number} 篇${removed ? "已移除文档" : "文档"}`,
    `${number} ${removed ? "removed " : ""}${count === 1 ? "document" : "documents"}`,
  );
}

export function useLocale() {
  const state = useSyncExternalStore(subscribeLocale, current, current);
  return { ...state, setPreference: setLanguagePreference, t: translate };
}

function apply(preference: LanguagePreference) {
  const language = resolveLanguage(preference, systemLanguages());
  const region = systemRegion();
  document.documentElement.lang = language;
  if (
    snapshot.language === language &&
    snapshot.preference === preference &&
    snapshot.region === region
  )
    return;
  snapshot = { language, preference, region };
  listeners.forEach((listener) => listener());
}
export function setLanguagePreference(preference: LanguagePreference) {
  try {
    localStorage.setItem(preferenceKey, preference);
  } catch {
    /* The window preference still applies. */
  }
  apply(preference);
}
function savedPreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === "zh-CN" || saved === "en" || saved === "system") return saved;
    const upgrading = Object.keys(localStorage).some((key) =>
      /^inkstone[:.]/.test(key),
    );
    const first = upgrading ? "zh-CN" : "system";
    localStorage.setItem(preferenceKey, first);
    return first;
  } catch {
    return "system";
  }
}
export function initializeLocale() {
  apply(savedPreference());
  const changed = () => apply(snapshot.preference);
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === preferenceKey) apply(savedPreference());
  };
  window.addEventListener("languagechange", changed);
  window.addEventListener("storage", stored);
  return () => {
    window.removeEventListener("languagechange", changed);
    window.removeEventListener("storage", stored);
  };
}
