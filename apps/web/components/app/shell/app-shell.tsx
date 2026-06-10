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
  { href: "/leaderboard", label: "Rank", icon: ListOrdered },
  { href: "/spin", label: "Spin", icon: Ticket },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              variant === "sidebar"
                ? `group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                    active
                      ? "bg-[var(--primary)]/10 text-[var(--primary)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.08)] border border-[var(--primary)]/20"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                  }`
                : `flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 transition-all duration-200 min-w-0 rounded-xl ${
                    active
                      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "text-slate-400 hover:text-slate-200"
                  }`
            }
          >
            <Icon
              className={`shrink-0 transition-transform duration-200 ${
                variant === "sidebar"
                  ? "h-5 w-5 group-hover:scale-110"
                  : "h-5 w-5"
              }`}
            />
            {variant === "mobile" ? (
              <span className="text-[10px] tracking-tight whitespace-nowrap text-center leading-tight font-medium w-full truncate">
                {label}
              </span>
            ) : (
              <span className="group-hover:translate-x-0.5 transition-transform duration-200">
                {label}
              </span>
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
      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-white/[0.05] bg-[#070910]/95 px-4 py-8 backdrop-blur-2xl md:flex md:flex-col relative">
        {/* Ambient glow behind logo */}
        <div
          className="pointer-events-none absolute top-0 left-0 right-0 h-40 bg-[radial-gradient(ellipse_100%_60%_at_50%_0%,rgb(var(--canton-rgb)/0.08),transparent_70%)]"
          aria-hidden
        />
        <Link
          href="/"
          className="relative mb-10 px-4 group flex items-center gap-2.5"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/15 border border-[var(--primary)]/20 group-hover:bg-[var(--primary)]/20 transition-colors duration-300">
            <Sparkles className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-slate-100">
              CanQuest
            </span>
            <p className="text-[10px] font-medium text-slate-500 leading-tight">
              Web3 Quest Platform
            </p>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          <NavLinks variant="sidebar" />
        </nav>

        {/* Footer status */}
        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgb(74_222_128/0.5)]" />
            <span className="text-xs font-medium text-slate-500">Mainnet Live</span>
          </div>
          <p className="px-4 text-xs font-medium text-slate-600">
            app.canquest.com
          </p>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-16 items-center border-b border-white/[0.05] bg-[#070910]/90 backdrop-blur-2xl px-6 md:h-20 md:px-10">
          <AppRouteTitle />
          {/* Right-side ambient */}
          <div className="ml-auto hidden sm:flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(74_222_128/0.4)]" />
            <span className="text-xs font-medium text-slate-500">Mainnet</span>
          </div>
        </header>

        <div className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 md:p-8 lg:p-10">
          {children}
        </div>
      </div>

      {/* ── Mobile Bottom Navigation ────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#070910]/95 backdrop-blur-2xl border-t border-white/[0.06] py-1.5 px-1 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.375rem)" }}
      >
        {/* Top glow line */}
        <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/20 to-transparent" />
        <div className="grid grid-cols-7 w-full items-end mx-auto max-w-lg gap-0">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}