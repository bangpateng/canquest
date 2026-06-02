"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Gift,
  LayoutGrid,
  Settings,
  Ticket,
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
import { cn } from "@/lib/utils/utils";

const navItems: {
  href: string;
  key: "overview" | "earn" | "quests" | "spin" | "wallet" | "leaderboard" | "settings";
  icon: LucideIcon;
}[] = [
  { href: "/overview", key: "overview", icon: LayoutGrid },
  { href: ROUTES.campaignQuests, key: "earn", icon: Sparkles },
  { href: ROUTES.earnHub, key: "quests", icon: Gift },
  { href: ROUTES.spinReward, key: "spin", icon: Ticket },
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
      ? "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all duration-200"
      : "flex flex-col items-center justify-center gap-1 py-1 px-0.5 sm:px-2 transition-all duration-200";

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
                ? " bg-slate-900/70 backdrop-blur-xl text-white shadow-lg shadow-black/20 ring-1 ring-inset ring-white/10"
                : " bg-slate-900/70 backdrop-blur-xl text-white shadow-lg shadow-black/20 ring-1 ring-white/10"
              : " text-slate-400 hover:bg-slate-900/40 hover:text-white hover:backdrop-blur-xl");

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
                  ? cn("h-5 w-5 shrink-0", active && "text-[var(--primary)]")
                  : "h-5 w-5 shrink-0"
              }
            />
            {variant === "mobile" ? (
              <span className="text-[10px] tracking-tight whitespace-nowrap text-center leading-tight">{label}</span>
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

  return (
    <div className="flex min-h-screen w-full max-w-full items-start overflow-x-hidden bg-[var(--background)]">
      {/* Desktop Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-white/[0.06] bg-slate-950/90 px-6 py-8 backdrop-blur-2xl md:flex">
        <div className="mb-6 min-w-0 px-2">
          <CanQuestLogo size="lg" href="/overview" className="w-full" />
        </div>
        <p className="mb-8 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
          {t("shell.platform")}
        </p>
        <nav className="flex flex-1 flex-col gap-2">
          <NavLinks variant="sidebar" hasWallet={hasWallet} />
        </nav>
        <div className="mt-auto space-y-2 border-t border-white/[0.06] pt-6">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-500 transition-all duration-200 hover:bg-slate-900/40 hover:text-slate-300"
          >
            <Compass className="h-4 w-4" />
            {t("shell.landing")}
          </Link>
          <p className="px-4 pt-2 text-[10px] font-medium text-slate-600">canquest.cc</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0" style={{ maxWidth: '100%' }}>
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 w-full max-w-full items-center justify-between gap-4 border-b border-white/[0.06] bg-[var(--background)]/95 px-4 backdrop-blur-2xl sm:h-[4.5rem] sm:px-6 md:px-8 lg:px-10">
          <CanQuestLogo
            size="lg"
            href="/overview"
            className="shrink-0 md:hidden"
          />
          <div className="hidden flex-1 md:block" />
          <PlatformToolbar />
        </header>

        {/* Page Content */}
        <main className="w-full max-w-full min-w-0 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 lg:px-10">
          <div className={cn(platformContentClass, "w-full max-w-full overflow-x-hidden")}>{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation - Premium Fixed Design */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-t border-white/5 py-1.5 px-0.5 sm:px-2 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.5rem)" }}
      >
        <div className="grid grid-cols-7 w-full justify-between items-center mx-auto max-w-md">
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
