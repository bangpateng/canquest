"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, Wallet } from "lucide-react";
import { PageLoading } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { useWalletAccess } from "@/lib/hooks/use-wallet-access";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils";

export function WalletRequiredGate({ children }: { children: React.ReactNode }) {
  const { hasWallet, loading } = useWalletAccess();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = usePlatformT();

  const from = searchParams.get("from") ?? pathname;

  useEffect(() => {
    if (!loading && !hasWallet) {
      const next = `/wallet?from=${encodeURIComponent(from)}`;
      if (pathname !== "/wallet") {
        router.replace(next);
      }
    }
  }, [loading, hasWallet, router, pathname, from]);

  if (loading) {
    return (
      <PageLoading label={t("common.loading")} minHeight="min-h-[40vh]" />
    );
  }

  if (!hasWallet) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-canton/30 bg-canton/10">
          <Lock className="h-7 w-7 text-canton" aria-hidden />
        </div>
        <h2 className="type-section-title">{t("walletGate.title")}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t("walletGate.description")}</p>
        <Link href={`/wallet?from=${encodeURIComponent(from)}`} className={cn(buttonVariants(), "gap-2")}>
          <Wallet className="h-4 w-4" />
          {t("walletGate.createWallet")}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
