"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gift, LayoutDashboard, ListOrdered, Settings, Sparkles, Ticket, Wallet } from "lucide-react";
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
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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
                ? `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  }`
                : `flex flex-col items-center gap-0.5 py-1.5 px-0.5 min-w-0 rounded-md transition-colors ${
                    active
                      ? "text-[var(--primary)]"
                      : "text-[var(--muted-foreground)]"
                  }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {variant === "mobile" ? (
              <span className="text-[10px] leading-tight font-medium text-center w-full truncate">{label}</span>
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
      {/* Desktop Sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-[var(--border)] bg-[var(--background)] px-3 py-6 md:flex md:flex-col">
        <Link href="/" className="mb-8 px-3">
          <span className="text-base font-bold tracking-tight text-[var(--foreground)]">CanQuest</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          <NavLinks variant="sidebar" />
        </nav>
        <p className="mt-auto px-3 text-xs text-[var(--muted-foreground)]">app.canquest.com</p>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden pb-20 md:pb-0">
        <header className="sticky top-0 z-40 flex h-14 items-center border-b border-[var(--border)] bg-[var(--background)] px-4 md:h-16 md:px-8">
          <AppRouteTitle />
        </header>
        <div className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--background)] py-1 px-1 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.25rem)" }}>
        <div className="grid grid-cols-7 w-full items-end mx-auto max-w-lg gap-0">
          <NavLinks variant="mobile" />
        </div>
      </nav>
    </div>
  );
}