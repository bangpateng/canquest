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
      ? "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-200"
      : "flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 transition-all duration-200 min-w-0";

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
                ? variant === "mobile"
                  ? " bg-slate-800/80 backdrop-blur-xl text-white shadow-md shadow-black/20 ring-1 ring-inset ring-white/10 rounded-lg"
                  : " bg-slate-800/80 backdrop-blur-xl text-white shadow-md shadow-black/20 ring-1 ring-white/10"
                : " text-slate-400 hover:bg-slate-800/50 hover:text-white hover:backdrop-blur-xl")
            }
          >
            <Icon
              className={
                variant === "sidebar"
                  ? "h-5 w-5 shrink-0"
                  : "h-5 w-5 shrink-0"
              }
            />
            {variant === "mobile" ? (
              <span className="text-[10px] tracking-tight whitespace-nowrap text-center leading-tight font-medium w-full truncate">
                {label}
              </span>
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
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--background)] font-sans">
      {/* Desktop Sidebar — hidden on mobile */}
      <aside className="hidden w-64 shrink-0 border-r border-white/[0.05] bg-slate-950/95 px-4 py-8 backdrop-blur-2xl md:flex md:flex-col">
        <Link
          href="/"
          className="mb-8 px-4 text-lg font-bold tracking-tight text-slate-100"
        >
          CanQuest
        </Link>
        <nav className="flex flex-1 flex-col gap-1.5">
          <NavLinks variant="sidebar" />
        </nav>
        <p className="mt-auto px-4 text-xs font-medium text-slate-600">
          app.canquest.com
        </p>
      </aside>

      {/* Main Content */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0">
        <header className="flex h-16 items-center border-b border-white/[0.05] bg-[var(--background)]/95 px-6 backdrop-blur-2xl md:h-20 md:px-10">
          <AppRouteTitle />
        </header>
        <div className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 md:p-10">
          {children}
        </div>
      </div>

      {/* Mobile Bottom Navigation — 7-item grid, no truncation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-xl border-t border-white/[0.06] py-1.5 px-1 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.375rem)" }}
      >
        <div className="grid grid-cols-7 w-full items-end mx-auto max-w-lg gap-0">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}
