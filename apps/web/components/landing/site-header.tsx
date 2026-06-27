"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

const nav: { href: string; label: string; icon: LucideIcon; description: string }[] = [
  { href: "#integrity", label: "Integrity", icon: ShieldCheck, description: "Anti-sybil" },
  { href: "#app", label: "App", icon: Sparkles, description: "Features" },
  { href: "#canton", label: "Wallet", icon: Wallet, description: "Canton CC" },
];

function MenuDots() {
  return (
    <span className="grid h-4 w-4 grid-cols-2 gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="rounded-[1px] bg-[var(--primary)]" />
      ))}
    </span>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <header className="sticky top-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl">
        <LandingShell className="flex h-16 items-center justify-between gap-4">
          <div className="flex shrink-0 items-center justify-start">
            <CanQuestLogo size="lg" href="/" onClick={close} />
          </div>

          <nav className="hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Main">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium text-[var(--muted-foreground)]",
                  "transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden shrink-0 md:block">
            <LaunchAppButton />
          </div>

          <button
            type="button"
            className={cn(
              "relative flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-all md:hidden",
              open
                ? "border-canton-strong bg-canton-subtle text-canton shadow-[0_0_20px_rgb(var(--canton-rgb)/0.12)]"
                : "border-[var(--border)] bg-[var(--card)]/90 text-[var(--foreground)] ring-1 ring-white/[0.04] hover:border-canton-muted hover:bg-[var(--muted)]",
            )}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {open ? (
                <X className="h-4 w-4 text-canton" strokeWidth={2.5} />
              ) : (
                <MenuDots />
              )}
            </span>
            <span className="text-xs uppercase tracking-wider">{open ? "Close" : "Menu"}</span>
          </button>
        </LandingShell>
      </header>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu backdrop"
            className="landing-menu-backdrop fixed inset-0 z-[60] bg-black/65 md:hidden"
            onClick={close}
          />
          <nav
            id="landing-mobile-nav"
            aria-label="Mobile"
            className="landing-menu-panel fixed inset-y-0 right-0 z-[70] flex w-[min(100vw,20rem)] flex-col border-l border-[var(--border)] bg-[var(--card)]/95 shadow-[-24px_0_64px_rgb(0_0_0/0.45)] max-md:backdrop-blur-xl md:hidden"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[rgb(var(--canton-rgb)/0.08)] to-transparent" />

            <div className="relative flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <CanQuestLogo size="md" href="/" onClick={close} />
              <button
                type="button"
                onClick={close}
                className={iconButtonClass("h-10 w-10 hover:text-canton")}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <ul className="relative flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={close}
                      className="group flex items-center gap-4 rounded-2xl px-3 py-3.5 transition-colors hover:bg-[var(--muted)]"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                        <Icon className="h-5 w-5 text-canton" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="type-subsection-title block">{item.label}</span>
                        <span className="block text-xs text-[var(--muted-foreground)]">
                          {item.description}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>

            <div className="relative space-y-3 border-t border-[var(--border)] px-5 py-4">
              <LaunchAppButton size="lg" className="w-full justify-center" />
            </div>
          </nav>
        </>
      ) : null}
    </>
  );
}
