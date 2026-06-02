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
      ? "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors"
      : "flex flex-col items-center justify-center gap-1 py-1 px-0.5 sm:px-2 transition-colors";

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
                ? " bg-[var(--primary)]/12 text-slate-100"
                : " text-slate-400 hover:bg-[var(--muted)] hover:text-slate-100")
            }
          >
            <Icon className={variant === "sidebar" ? "h-5 w-5 shrink-0" : "h-5 w-5 shrink-0 sm:h-6 sm:w-6"} />
            {variant === "mobile" ? (
              <span className="text-[10px] sm:text-xs font-medium tracking-tight whitespace-nowrap text-center leading-tight">{label}</span>
            ) : (
              label
            )}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="hidden w-72 shrink-0 border-r border-white/5 bg-[var(--card)]/60 px-4 py-8 md:flex md:flex-col">
        <Link
          href="/"
          className="mb-10 px-4 text-xl font-bold text-slate-100"
        >
          CanQuest
        </Link>
        <nav className="flex flex-1 flex-col gap-2">
          <NavLinks variant="sidebar" />
        </nav>
        <p className="mt-auto px-4 text-sm font-medium text-slate-400">
          app.canquest.com
        </p>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col pb-20 md:pb-0">
        <header className="flex h-16 items-center border-b border-white/5 px-6 md:h-20 md:px-10">
          <AppRouteTitle />
        </header>
        <div className="min-w-0 flex-1 space-y-6 overflow-x-hidden p-6 md:p-10">
          {children}
        </div>
      </div>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-t border-white/5 py-1.5 px-0.5 sm:px-2 md:hidden">
        <div className="grid grid-cols-7 w-full justify-between items-center mx-auto max-w-md">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}
