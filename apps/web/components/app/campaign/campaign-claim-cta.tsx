"use client";

import Link from "next/link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { errorBannerClass, successBannerClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

/**
 * Claim CTA ala mockup upload — cukup SATU tombol gradient "Claim".
 * Semua rincian (fee/slots/deskripsi) pindah ke ClaimDetailsModal.
 * Pesan status (wallet belum ada, delivery, error, success) tetap tampil
 * di bawah tombol — fungsi claim tidak berubah.
 */
export function CampaignClaimCta({
  label,
  disabled = false,
  isSubmitting = false,
  needsWallet = false,
  error = null,
  success = null,
  deliveryKind = null,
  onClaim,
}: {
  /** Label tombol, menyesuaikan tipe reward (mis. "Claim", "Claim your Code"). */
  label: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  /** True bila partyId belum ada — tombol disabled + catatan buat wallet. */
  needsWallet?: boolean;
  error?: string | null;
  success?: string | null;
  deliveryKind?: "direct" | "pending_offer" | null;
  onClaim: () => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled || isSubmitting || needsWallet}
        onClick={onClaim}
        className={cn(
          buttonVariants({ size: "block" }),
          "h-12 text-sm font-bold",
        )}
      >
        {isSubmitting ? <LoadingSpinner size="sm" /> : null}
        {isSubmitting ? "Claiming…" : label}
      </button>

      {needsWallet ? (
        <p className="text-sm font-medium text-orange-600">
          <Link href="/wallet" className="font-semibold underline underline-offset-2">
            Create your wallet
          </Link>{" "}
          first to claim on Canton.
        </p>
      ) : null}

      {deliveryKind ? (
        <p
          className={cn(
            "inline-flex w-full items-center gap-2",
            successBannerClass,
            deliveryKind === "direct" ? "" : "border-amber-500/30 bg-amber-500/10 text-amber-600",
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

      {error ? <p className={cn(errorBannerClass)}>{error}</p> : null}
      {success ? (
        <p className={cn("whitespace-pre-line", successBannerClass)}>{success}</p>
      ) : null}
    </div>
  );
}
