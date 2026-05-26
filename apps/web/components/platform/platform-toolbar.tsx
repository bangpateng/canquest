"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { usePlatformI18n } from "@/lib/i18n/platform-provider";
import type { PlatformLocale } from "@/lib/i18n";
import { iconButtonClass, toolbarMenuButtonClass } from "@/lib/ui-button-styles";
import { cn } from "@/lib/utils";
import { TransactionNotifications } from "@/components/platform/transaction-notifications";

export function PlatformToolbar() {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, locales, t } = usePlatformI18n();
  const [langOpen, setLangOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = locales.find((l) => l.code === locale);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setLangOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={toggleTheme}
        className={iconButtonClass("h-9 w-9")}
        aria-label={t("theme.toggle")}
        title={theme === "dark" ? t("theme.light") : t("theme.dark")}
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" aria-hidden />
        ) : (
          <Moon className="h-4 w-4" aria-hidden />
        )}
      </button>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setLangOpen((o) => !o)}
          className={toolbarMenuButtonClass()}
          aria-label={t("lang.select")}
          aria-expanded={langOpen}
          aria-haspopup="listbox"
        >
          <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <span className="hidden uppercase tracking-wide sm:inline">
            {locale}
          </span>
          <span className="max-w-[5rem] truncate sm:max-w-none">{current?.native}</span>
        </button>

        {langOpen ? (
          <ul
            role="listbox"
            aria-label={t("lang.label")}
            className="absolute right-0 top-full z-50 mt-1.5 min-w-[10.5rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {locales.map((item) => {
              const selected = item.code === locale;
              return (
                <li key={item.code} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocale(item.code as PlatformLocale);
                      setLangOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--primary)]/10",
                      selected && "bg-[var(--primary)]/15 font-semibold text-[var(--foreground)]",
                    )}
                  >
                    <span>{item.native}</span>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      {item.code}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <TransactionNotifications />
    </div>
  );
}
