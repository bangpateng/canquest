"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { LandingShell } from "@/components/landing/landing-shell";

const NAV = [
  { label: "How it works", href: "#lock" },
  { label: "App", href: "#app" },
  { label: "FAQ", href: "#faq" },
  { label: "Docs", href: "/docs" },
];

/**
 * Sticky marketing header: logo (left) + nav.
 * On desktop the links show inline; on small screens they collapse into a
 * hamburger menu. The Launch App CTA lives only in the hero + final CTA.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  // Close the mobile menu when the viewport grows to desktop.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/70 backdrop-blur-xl">
      <LandingShell className="flex h-16 items-center gap-4">
        <CanQuestLogo size="md" href="/" />

        {/* Desktop nav (md and up) */}
        <nav className="ml-auto hidden items-center gap-6 md:flex" aria-label="Landing">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Mobile hamburger toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--primary)]/10 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </LandingShell>

      {/* Mobile dropdown menu */}
      {open ? (
        <nav
          className="border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur-xl md:hidden"
          aria-label="Landing mobile"
        >
          <LandingShell className="flex flex-col py-2">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--primary)]/5"
              >
                {item.label}
              </a>
            ))}
          </LandingShell>
        </nav>
      ) : null}
    </header>
  );
}
