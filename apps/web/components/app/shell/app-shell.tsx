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
      : "flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors";

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
                : " text-slate-400 hover:bg-[var(--muted)] hover:text-slate-100") +
              (variant === "mobile" ? " min-w-[4.5rem] shrink-0" : "")
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
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/5 bg-[var(--card)]/95 backdrop-blur-md md:hidden">
        <div className="flex max-w-full gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}
