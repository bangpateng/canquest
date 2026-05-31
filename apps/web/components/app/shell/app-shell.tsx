"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Gift,
  LayoutDashboard,
  ListOrdered,
  Settings,
  Sparkles,
  Ticket,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppRouteTitle } from "@/components/app/shell/app-route-title";
import { ROUTES } from "@/lib/routing/app-routes";
const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: ROUTES.campaignQuests, label: "Earn", icon: Sparkles },
  { href: ROUTES.earnHub, label: "Quest", icon: Gift },
  { href: "/leaderboard", label: "Leaderboard", icon: ListOrdered },
  { href: "/spin", label: "Spin", icon: Ticket },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const base =
    variant === "sidebar"
      ? "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
      : "flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-medium transition-colors";

  return (
    <>
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              base +
              (active
                ? " bg-[var(--primary)]/12 text-[var(--foreground)]"
                : " text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]") +
              (variant === "mobile" ? " min-w-[4.25rem] shrink-0" : "")
            }
          >
            <Icon className={variant === "sidebar" ? "h-5 w-5 shrink-0" : "h-5 w-5"} />
            {variant === "mobile" ? <span>{label}</span> : label}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)]/60 px-3 py-6 md:flex md:flex-col">
        <Link
          href="/"
          className="type-section-title mb-8 px-3"
        >
          CanQuest
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          <NavLinks variant="sidebar" />
        </nav>
                <p className="mt-auto px-3 text-xs text-[var(--muted-foreground)]">
          app.canquest.com
        </p>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col pb-20 md:pb-0">
        <header className="flex h-14 items-center border-b border-[var(--border)] px-4 md:h-16 md:px-8">
          <AppRouteTitle />
        </header>
                <div className="min-w-0 flex-1 space-y-4 overflow-x-hidden p-4 md:p-8">
          {children}
        </div>
      </div>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-md md:hidden">
        <div className="flex max-w-full gap-0.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}
