import type { PlatformLocale, PlatformMessages } from "./types";
import { de } from "./messages/de";
import { en } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { pt } from "./messages/pt";
import { zh } from "./messages/zh";

export type { PlatformLocale, PlatformMessages };
export { PLATFORM_LOCALES } from "./types";

export const platformMessages: Record<PlatformLocale, PlatformMessages> = {
  en,
  es,
  fr,
  de,
  pt,
  zh,
};

export const DEFAULT_PLATFORM_LOCALE: PlatformLocale = "en";
export const PLATFORM_LOCALE_STORAGE_KEY = "canquest-locale";

type MessageParams = Record<string, string | number>;

function resolvePath(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function interpolate(
  template: string,
  params?: MessageParams,
): string {
  if (!params) return template;
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(value)),
    template,
  );
}

export function createTranslator(locale: PlatformLocale) {
  const dict = platformMessages[locale] ?? platformMessages.en;
  const fallback = platformMessages.en;

  return function t(path: string, params?: MessageParams): string {
    const raw = resolvePath(dict, path) ?? resolvePath(fallback, path) ?? path;
    return interpolate(raw, params);
  };
}

export function isPlatformLocale(value: string): value is PlatformLocale {
  return value in platformMessages;
}
