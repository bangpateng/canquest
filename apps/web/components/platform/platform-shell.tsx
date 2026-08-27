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
import { TransactionStatusModal } from "@/components/platform/transaction-status-modal";
import { platformContentClass } from "@/components/platform/platform-page";
import { PlatformI18nProvider, usePlatformI18n } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { useWalletAccess } from "@/lib/hooks/use-wallet-access";
import { hrefRequiresWallet } from "@/lib/auth/wallet-access";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useAutoAccept } from "@/lib/wallet/auto-accept";
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

/** Label muncul di kanan ikon saat hover / keyboard-focus (desktop rail). */
function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg bg-[var(--foreground)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--background)] opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
      {label}
    </span>
  );
}

function useNavState(hasWallet: boolean) {
  const pathname = usePathname();
  const { t } = usePlatformI18n();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return navItems.map(({ href, key, icon: Icon }) => {
    const active = isActive(href);
    const label = t(`nav.${key}`);
    const locked = hrefRequiresWallet(href) && !hasWallet;
    const hrefTarget = locked ? `/wallet?from=${encodeURIComponent(href)}` : href;
    return { href, hrefTarget, label, locked, active, Icon };
  });
}

/** Desktop icon rail — 72px, ikon saja + tooltip. Aktif = pill gradient brand. */
function RailNav({ hasWallet }: { hasWallet: boolean }) {
  const items = useNavState(hasWallet);

  return (
    <>
      {items.map(({ href, hrefTarget, label, locked, active, Icon }) => (
        <div key={href} className="group relative">
          <Link
            href={hrefTarget}
            title={locked ? label : undefined}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
              locked
                ? "cursor-not-allowed text-[var(--muted-foreground)] opacity-40"
                : active
                  ? "bg-gradient-brand text-[var(--primary-foreground)] shadow-[var(--shadow-glow)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon className="h-[21px] w-[21px] shrink-0" strokeWidth={active ? 2.4 : 2} />
          </Link>
          <RailTooltip label={label} />
        </div>
      ))}
    </>
  );
}

/** Bottom nav mobile — ikon + label kecil, aktif = pill hijau lembut. */
function MobileNav({ hasWallet }: { hasWallet: boolean }) {
  const items = useNavState(hasWallet);

  return (
    <>
      {items.map(({ href, hrefTarget, label, locked, active, Icon }) => (
        <Link
          key={href}
          href={hrefTarget}
          title={locked ? label : undefined}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-all duration-200",
            locked && "opacity-40",
            active
              ? "bg-canton-subtle text-canton"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.4 : 2} />
          <span className="w-full truncate text-center text-[10px] font-medium leading-tight tracking-tight">
            {label}
          </span>
        </Link>
      ))}
    </>
  );
}

function PlatformShellInner({ children }: { children: React.ReactNode }) {
  const { t } = usePlatformI18n();
  const { hasWallet } = useWalletAccess();
  // Realtime SSE push — push transaksi/balance baru dari server → invalidate
  // cache react-query → update UI instan. No-op bila belum login (BFF 401).
  useRealtime();
  // M5: auto-accept incoming transfers while wallet unlocked (UX like custodial)
  useAutoAccept();

  return (
    <div className="relative flex min-h-screen w-full max-w-full isolate items-stretch overflow-x-hidden bg-[var(--background)] font-sans">
      {/* Ambient tint — fixed, very subtle radial wash (canton / cyan). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(48rem 30rem at 14% -8%, rgb(var(--canton-rgb) / 0.07), transparent 60%), radial-gradient(40rem 26rem at 100% 8%, rgb(var(--canton-cyan-rgb) / 0.05), transparent 55%)",
        }}
      />

      {/* Desktop icon rail */}
      <aside className="sticky top-0 z-40 hidden h-screen w-[72px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--card)] py-5 md:flex">
        {/* Nav — brand wordmark ada di header atas (CanQuestLogo). */}
        <nav className="flex flex-1 flex-col items-center gap-2" aria-label={t("shell.platform")}>
          <RailNav hasWallet={hasWallet} />
        </nav>

        {/* Bottom actions */}
        <div className="mt-auto flex flex-col items-center gap-2 border-t border-[var(--border)] pt-4">
          <div className="group relative">
            <Link
              href="/"
              aria-label={t("shell.landing")}
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-[var(--muted-foreground)] transition-all duration-200 hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Compass className="h-[21px] w-[21px]" />
            </Link>
            <RailTooltip label={t("shell.landing")} />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0" style={{ maxWidth: "100%" }}>
        {/* Top Header — wordmark kiri (semua breakpoint), toolbar kanan */}
        <header className="sticky top-0 z-30 flex h-16 w-full max-w-full items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--card)]/85 px-4 backdrop-blur-xl sm:h-[4.25rem] sm:px-6 md:px-8 lg:px-10">
          <CanQuestLogo size="md" href="/overview" />
          <div className="hidden flex-1 md:block" />
          <PlatformToolbar />
        </header>

        {/* Page Content */}
        <main className="w-full max-w-full min-w-0 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 lg:px-10">
          <div className={cn(platformContentClass, "w-full max-w-full overflow-x-hidden")}>{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--card)]/95 px-2 py-1.5 shadow-[0_-8px_24px_-16px_rgb(12_18_34/0.18)] backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0.375rem)" }}
        aria-label={t("shell.platform")}
      >
        <div className="mx-auto grid w-full max-w-lg grid-cols-6 items-center gap-0">
          <MobileNav hasWallet={hasWallet} />
        </div>
      </nav>

      {/* Unified on-chain transaction status dialog (Sign → Broadcast → Confirmed). */}
      <TransactionStatusModal />
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
