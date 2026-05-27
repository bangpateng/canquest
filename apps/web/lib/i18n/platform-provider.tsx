"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createTranslator,
  DEFAULT_PLATFORM_LOCALE,
  PLATFORM_LOCALE_STORAGE_KEY,
  type PlatformLocale,
} from "./index";
import { PLATFORM_LOCALES } from "./types";

type PlatformI18nContextValue = {
  locale: PlatformLocale;
  setLocale: (locale: PlatformLocale) => void;
  t: ReturnType<typeof createTranslator>;
  locales: typeof PLATFORM_LOCALES;
};

const PlatformI18nContext = createContext<PlatformI18nContextValue | null>(null);

const REMOVED_LOCALES = new Set(["id", "es", "fr", "de", "pt", "zh"]);

function readStoredLocale(): PlatformLocale {
  if (typeof window === "undefined") return DEFAULT_PLATFORM_LOCALE;
  try {
    const stored = localStorage.getItem(PLATFORM_LOCALE_STORAGE_KEY);
    if (stored && REMOVED_LOCALES.has(stored)) return DEFAULT_PLATFORM_LOCALE;
    if (stored && PLATFORM_LOCALES.some((l) => l.code === stored)) {
      return stored as PlatformLocale;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PLATFORM_LOCALE;
}

export function PlatformI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<PlatformLocale>(DEFAULT_PLATFORM_LOCALE);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((next: PlatformLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(PLATFORM_LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, locales: PLATFORM_LOCALES }),
    [locale, setLocale, t],
  );

  return (
    <PlatformI18nContext.Provider value={value}>{children}</PlatformI18nContext.Provider>
  );
}

export function usePlatformI18n() {
  const ctx = useContext(PlatformI18nContext);
  if (!ctx) {
    throw new Error("usePlatformI18n must be used within PlatformI18nProvider");
  }
  return ctx;
}

/** Safe translator for shared components; falls back to English outside platform. */
export function usePlatformT() {
  const ctx = useContext(PlatformI18nContext);
  const fallbackT = useMemo(() => createTranslator(DEFAULT_PLATFORM_LOCALE), []);
  return ctx?.t ?? fallbackT;
}
