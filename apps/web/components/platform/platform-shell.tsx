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

      ? "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"

      : "flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-medium transition-all sm:px-2 sm:text-[10px]";



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

            ? " opacity-60"

            : active

              ? variant === "mobile"

                ? " bg-[var(--primary)]/14 text-[var(--foreground)] ring-1 ring-inset ring-[var(--primary)]/30"

                : " bg-[var(--primary)]/14 text-[var(--foreground)] ring-1 ring-[var(--primary)]/25"

              : " text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]");

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

    <div className="flex min-h-screen items-start bg-[var(--background)]">

      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/80 px-3 py-6 backdrop-blur-xl md:flex">

        <div className="mb-2 min-w-0 px-3">

          <CanQuestLogo size="lg" href="/overview" className="w-full" />

        </div>

        <p className="mb-6 px-3 text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">

          {t("shell.platform")}

        </p>

        <nav className="flex flex-1 flex-col gap-1">

          <NavLinks variant="sidebar" hasWallet={hasWallet} />

        </nav>

        <div className="mt-auto space-y-2 border-t border-[var(--border)] pt-4">

          <Link

            href="/"

            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"

          >

            <Compass className="h-4 w-4" />

            {t("shell.landing")}

          </Link>

          <p className="px-3 text-[10px] text-[var(--muted-foreground)]">canquest.cc</p>

        </div>

      </aside>



      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pb-20 md:pb-0">

        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)]/85 px-4 backdrop-blur-md md:h-16 md:px-8">

          <CanQuestLogo

            size="lg"

            href="/overview"

            className="shrink-0 md:hidden"

          />

          <div className="hidden flex-1 md:block" />

          <PlatformToolbar />

        </header>

        <main className="min-w-0 p-4 md:p-8">
          <div className={platformContentClass}>{children}</div>
        </main>

      </div>



      <nav

        className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-md md:hidden"

        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}

      >

        <div className="flex w-full min-w-0 gap-0.5 px-1 py-1">

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

