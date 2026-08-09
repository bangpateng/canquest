"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Gift,
  LayoutGrid,
  Settings,
  Trophy,
  Wallet,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { PlatformToolbar } from "@/components/platform/platform-toolbar";
import { platformContentClass } from "@/components/platform/platform-page";
import { PlatformI18nProvider, usePlatformI18n } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { useWalletAccess } from "@/lib/hooks/use-wallet-access";
import { hrefRequiresWallet } from "@/lib/auth/wallet-access";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { cn } from "@/lib/utils/utils";

const navItems: {
  href: string;
  key: "overview" | "earn" | "quests" | "wallet" | "leaderboard" | "settings";
  icon: LucideIcon;
}[] = [
  { href: "/overview", key: "overview", icon: LayoutGrid },
  { href: ROUTES.campaignQuests, key: "earn", icon: Sparkles },
  { href: ROUTES.questHub, key: "quests", icon: Gift },
  { href: "/wallet", key: "wallet", icon: Wallet },
  { href: ROUTES.leaderboard, key: "leaderboard", icon: Trophy },
  { href: "/settings", key: "settings", icon: Settings },
];

function NavLinks({
  variant,
  hasWallet,
}: {
  variant: "sidebar" | "mobile";
  hasWallet: boolean;
}) {
  const pathname = usePathname();
  const { t } = usePlatformI18n();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const base =
    variant === "sidebar"
      ? "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-200"
      : "flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 transition-all duration-200 min-w-0";

  return (
    <>
      {navItems.map(({ href, key, icon: Icon }) => {
        const active = isActive(href);
        const label = t(`nav.${key}`);
        const locked = hrefRequiresWallet(href) && !hasWallet;
        const hrefTarget = locked ? `/wallet?from=${encodeURIComponent(href)}` : href;
        const className =
          base +
          (locked
            ? " opacity-50 cursor-not-allowed"
            : active
              ? variant === "mobile"
                ? " bg-canton-subtle text-[var(--foreground)] shadow-md shadow-black/20 ring-1 ring-inset ring-[var(--primary)]/20 rounded-lg"
                : " bg-canton-subtle text-[var(--foreground)] shadow-md shadow-black/20 ring-1 ring-[var(--primary)]/20"
              : " text-[var(--muted-foreground)] hover:bg-[var(--primary)]/5 hover:text-[var(--foreground)]");

        return (
          <Link
            key={href}
            href={hrefTarget}
            title={locked ? t("walletGate.navLocked") : undefined}
            className={className}
          >
            <Icon
              className={
                variant === "sidebar"
                  ? cn("h-5 w-5 shrink-0", active && "text-canton")
                  : cn("h-5 w-5 shrink-0", active ? "text-canton" : "text-[var(--muted-foreground)]")
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

function PlatformShellInner({ children }: { children: React.ReactNode }) {
  const { t } = usePlatformI18n();
  const { hasWallet } = useWalletAccess();
  // Realtime SSE push — push transaksi/balance baru dari server → invalidate
  // cache react-query → update UI instan. No-op bila belum login (BFF 401).
  useRealtime();

  return (
    <div className="flex min-h-screen w-full max-w-full items-start overflow-x-hidden bg-[var(--background)] font-sans">
      {/* Desktop Sidebar — hidden on mobile */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/60 px-4 py-8 backdrop-blur-2xl md:flex">
        <div className="mb-6 min-w-0 px-2">
          <CanQuestLogo size="md" href="/overview" />
        </div>
        <p className="mb-6 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
          {t("shell.platform")}
        </p>
        <nav className="flex flex-1 flex-col gap-1.5">
          <NavLinks variant="sidebar" hasWallet={hasWallet} />
        </nav>
        <div className="mt-auto space-y-1 border-t border-[var(--border)] pt-5">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--muted-foreground)] transition-all duration-200 hover:bg-[var(--primary)]/5 hover:text-[var(--foreground)]"
          >
            <Compass className="h-4 w-4" />
            {t("shell.landing")}
          </Link>
          <p className="px-4 pt-2 text-[10px] font-medium text-[var(--muted-foreground)]">canquest.cc</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0" style={{ maxWidth: '100%' }}>
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 w-full max-w-full items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--background)]/80 px-4 backdrop-blur-2xl sm:h-[4.5rem] sm:px-6 md:px-8 lg:px-10">
          {/* Match landing-header structure: wrap logo in a flex/centered box so
              the lockup sits vertically centered like on the landing page. */}
          <div className="flex shrink-0 items-center justify-start md:hidden">
            <CanQuestLogo size="md" href="/overview" />
          </div>
          <div className="hidden flex-1 md:block" />
          <PlatformToolbar />
        </header>

        {/* Page Content */}
        <main className="w-full max-w-full min-w-0 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 lg:px-10">
          <div className={cn(platformContentClass, "w-full max-w-full overflow-x-hidden")}>{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation — centered 6-item grid, no truncation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--card)]/90 backdrop-blur-xl border-t border-[var(--border)] py-1.5 px-2 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.375rem)" }}
      >
        <div className="grid grid-cols-6 w-full items-center mx-auto max-w-lg gap-0">
          <NavLinks variant="mobile" hasWallet={hasWallet} />
        </div>
      </nav>
    </div>
  );
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <PlatformI18nProvider>
      <PlatformShellInner>{children}</PlatformShellInner>
    </PlatformI18nProvider>
  );
}
