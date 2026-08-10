"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, Wallet } from "lucide-react";
import { PageLoading } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWalletAccess } from "@/lib/hooks/use-wallet-access";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils/utils";

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
      <div className="mx-auto flex min-h-[50vh] max-w-md items-center justify-center px-4 py-10">
        <Card className="w-full overflow-hidden p-8 text-center sm:p-10">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-canton-muted bg-canton-subtle">
              <Lock className="h-7 w-7 text-canton" aria-hidden />
            </div>
            <h2 className="type-section-title">{t("walletGate.title")}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{t("walletGate.description")}</p>
            <Link
              href={`/wallet?from=${encodeURIComponent(from)}`}
              className={cn(buttonVariants(), "mt-2 gap-2")}
            >
              <Wallet className="h-4 w-4" />
              {t("walletGate.createWallet")}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
