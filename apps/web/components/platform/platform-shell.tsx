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

      ? "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200"

      : "flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-2.5 text-[9px] font-medium transition-all duration-200 sm:px-2 sm:text-[10px]";



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

            ? " opacity-50"

            : active

              ? variant === "mobile"

                ? " bg-[var(--primary)]/12 text-[var(--foreground)] shadow-sm shadow-[var(--primary)]/5 ring-1 ring-inset ring-[var(--primary)]/20"

                : " bg-[var(--primary)]/10 text-[var(--foreground)] shadow-sm shadow-[var(--primary)]/5 ring-1 ring-[var(--primary)]/15"

              : " text-[var(--muted-foreground)] hover:bg-white/[0.04] hover:text-[var(--foreground)]");

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

                  ? cn("h-5 w-5 shrink-0", active && "text-[var(--primary-strong)]")

                  : "h-5 w-5"

              }

            />

            {variant === "mobile" ? (

              <span className="max-w-full truncate text-center leading-tight">{label}</span>

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

    <div className="flex min-h-screen items-start overflow-x-hidden bg-[var(--background)]">

      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-white/[0.06] bg-slate-950/80 px-5 py-8 backdrop-blur-2xl md:flex">

        <div className="mb-4 min-w-0 px-2">

          <CanQuestLogo size="lg" href="/overview" className="w-full" />

        </div>

        <p className="mb-8 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">

          {t("shell.platform")}

        </p>

        <nav className="flex flex-1 flex-col gap-1.5">

          <NavLinks variant="sidebar" hasWallet={hasWallet} />

        </nav>

        <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-6">

          <Link

            href="/"

            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300"

          >

            <Compass className="h-4 w-4" />

            {t("shell.landing")}

          </Link>

          <p className="px-3 pt-2 text-[10px] font-medium text-slate-600">canquest.cc</p>

        </div>

      </aside>



      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pb-24 md:pb-0" style={{ maxWidth: '100vw', overflowX: 'hidden' }}>

        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-white/[0.06] bg-[var(--background)]/90 px-4 backdrop-blur-2xl sm:px-6 md:h-[4.5rem] md:px-8 lg:px-10">

          <CanQuestLogo

            size="lg"

            href="/overview"

            className="shrink-0 md:hidden"

          />

          <div className="hidden flex-1 md:block" />

          <PlatformToolbar />

        </header>

        <main className="min-w-0 w-full max-w-full overflow-x-hidden p-4 sm:p-6 md:p-8 lg:p-10" style={{ maxWidth: '100%', overflowX: 'hidden' }}>
          <div className={platformContentClass} style={{ maxWidth: '100%', overflowX: 'hidden' }}>{children}</div>
        </main>

      </div>



      <nav

        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.06] bg-slate-950/95 backdrop-blur-2xl md:hidden"

        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}

      >

        <div className="flex w-full min-w-0 gap-0.5 px-2 py-2">

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

