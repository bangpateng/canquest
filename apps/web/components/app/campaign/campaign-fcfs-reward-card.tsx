"use client";

import Link from "next/link";
import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { CheckCircle2, Sparkles, Ticket } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  errorBannerClass,
  successBannerClass,
} from "@/lib/ui/ui-tokens";
import { getRewardConfig } from "@/lib/quest/quest-engine";
import { cn } from "@/lib/utils/utils";

type CampaignFcfsRewardCardProps = {
  mode: "claim" | "status";
  slotsLabel: string;
  description?: string | null;
  rewardCc?: number;
  partyId?: string | null;
  canClaim?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
  success?: string | null;
  onClaim?: () => void;
  /** Override section label (default: FCFS reward). */
  sectionLabel?: string;
  /** Override claim button label. */
  claimButtonLabel?: string;
  /**
   * Tipe reward — menentukan icon badge (sesuai resolveIconKind di quest-engine):
   *  - CC/USDCx token  → token reward logo
   *  - Waitlist email  → Sparkles
   *  - Code            → Ticket
   *  - token + Code    → token logo + Ticket
   * Default (null) = token reward logo (kompatibel perilaku lama).
   */
  rewardType?: string | null;
  /** Token reward: "CC" (default) atau "USDCx". */
  rewardToken?: string | null;
  /** Status pengiriman reward (hanya relevan setelah claim). direct = masuk wallet; pending_offer = accept di inbox. */
  deliveryKind?: "direct" | "pending_offer" | null;
};

export function CampaignFcfsRewardCard({
  mode,
  slotsLabel,
  description,
  rewardCc = 0,
  partyId = null,
  canClaim = false,
  isSubmitting = false,
  error = null,
  success = null,
  onClaim,
  sectionLabel = "FCFS reward",
  claimButtonLabel,
  rewardType = null,
  rewardToken = "CC",
  deliveryKind = null,
}: CampaignFcfsRewardCardProps) {
  const isStatus = mode === "status";
  const showClaimButton = mode === "claim" && canClaim && onClaim;

  // Resolve icon + warna badge berdasarkan tipe reward (sama seperti reward-reveal.tsx).
  const config = getRewardConfig(rewardType);
  const isDual = config.isDual;
  const isCcOnly = config.isCcToken && !isDual;
  const isWaitlist = config.code === "WAITLIST_EMAIL";
  // Token theme: USDCx = biru, CC = mint (default canton). Drives accent color badge.
  const isUsdcx = (rewardToken ?? "CC").toUpperCase() === "USDCX";

  return (
    <Card className="relative overflow-hidden px-6 py-5">
      {/* Ambient glow — canton-tinted when claimable, neutral when status-only. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isStatus
            ? "bg-[radial-gradient(ellipse_60%_80%_at_0%_0%,rgb(var(--canton-rgb)/0.06),transparent_60%)]"
            : "bg-[radial-gradient(ellipse_60%_80%_at_0%_0%,rgb(var(--canton-rgb)/0.12),transparent_60%)]",
        )}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              isStatus
                ? "bg-[var(--muted)]/60 text-[var(--muted-foreground)]"
                : isDual
                  ? isUsdcx
                    ? "bg-gradient-to-br from-sky-400/15 to-violet-500/15 text-violet-300"
                    : "bg-gradient-to-br from-canton/15 to-violet-500/15 text-violet-300"
                  : isCcOnly
                    ? isUsdcx
                      ? "bg-sky-400/15 text-sky-300"
                      : "bg-[var(--primary)]/15 text-canton"
                    : isWaitlist
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "bg-violet-500/15 text-violet-400",
            )}
          >
            {isStatus ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            ) : isDual ? (
              <span className="flex items-center justify-center gap-0.5">
                <RewardTokenLogo token={rewardToken} size={16} />
                <Ticket className="h-4 w-4 text-violet-300" strokeWidth={2.5} aria-hidden />
              </span>
            ) : isCcOnly ? (
              <RewardTokenLogo token={rewardToken} size={20} />
            ) : isWaitlist ? (
              <Sparkles className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            ) : (
              <Ticket className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {sectionLabel}
            </p>
            <p className="mt-1 text-base font-bold leading-snug text-[var(--foreground)]">
              {slotsLabel}
            </p>
            {description ? (
              <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--muted-foreground)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {showClaimButton ? (
          <button
            type="button"
            disabled={isSubmitting || !partyId}
            onClick={onClaim}
            className={cn(
              buttonVariants({ size: "default" }),
              "w-full shrink-0 gap-2 sm:w-auto sm:min-w-[9.5rem]",
            )}
          >
            {isSubmitting ? <LoadingSpinner size="sm" /> : null}
            {isSubmitting ? "Claiming…" : (claimButtonLabel ?? "Claim")}
          </button>
        ) : null}
      </div>

      {mode === "claim" && !partyId ? (
        <p className="relative mt-4 text-sm font-medium text-orange-300">
          <Link href="/wallet" className="font-semibold underline underline-offset-2">
            Create your wallet
          </Link>{" "}
          first to claim on Canton.
        </p>
      ) : null}

      {deliveryKind ? (
        <p
          className={cn(
            "relative mt-4 inline-flex items-center gap-2",
            successBannerClass,
            deliveryKind === "direct" ? "" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
          )}
        >
          {deliveryKind === "direct" ? (
            <>✓ Reward sent directly to your wallet.</>
          ) : (
            <>
              ⏳ Reward is pending —{" "}
              <Link href="/wallet" className="font-semibold underline underline-offset-2">
                accept it in your Wallet inbox
              </Link>
              .
            </>
          )}
        </p>
      ) : null}

      {error ? (
        <p className={cn("relative mt-4", errorBannerClass)}>{error}</p>
      ) : null}

      {success ? (
        <p className={cn("relative mt-4 whitespace-pre-line", successBannerClass)}>
          {success}
        </p>
      ) : null}
    </Card>
  );
}
