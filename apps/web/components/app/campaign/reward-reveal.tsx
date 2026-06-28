"use client";

import { useState } from "react";
import { CheckCircle2, Check, Copy, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { RewardHowToUse } from "@/components/app/campaign/reward-how-to-use";

/**
 * Blok tampilan "reveal" hadiah setelah claim berhasil — konsisten untuk semua
 * tipe reward. Sebelumnya kode invite-code ditampilkan dalam 3 desain berbeda
 * (violet di quest-submit-section, canton di raffle-claim, inline di tempat lain).
 * Sekarang satu komponen, desain canton-consistent, dengan copy button + how-to-use.
 */
export function RewardReveal({
  inviteCode,
  rewardCc,
  redeemUrl,
  redeemInstructions,
  className,
}: {
  /** Kode invite yang di-reveal (boleh null bila reward hanya CC). */
  inviteCode?: string | null;
  /** Jumlah CC yang dikirim (boleh null/0 bila reward hanya kode). */
  rewardCc?: number | null;
  /** Link register/landing proyek (shown in "How to use" section). */
  redeemUrl?: string | null;
  /** Instruksi custom redeem; kosong = pakai template 3-step default. */
  redeemInstructions?: string | null;
  className?: string;
}) {
  const t = usePlatformT();

  if (!inviteCode && !rewardCc) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-canton-muted bg-canton-subtle p-5",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
          <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--foreground)]">
            {t("earnCampaigns.congratsTitle")}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("earnCampaigns.rewardsReady")}
          </p>
        </div>
      </div>

      {/* Reward rows */}
      <div className="mt-4 space-y-3">
        {rewardCc ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-canton-muted bg-[var(--card)]/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("earnCampaigns.ccReward")}
              </p>
              <p className="font-mono text-lg font-bold tabular-nums text-canton">
                +{rewardCc} CC
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-canton">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("earnCampaigns.ccSentToWallet")}
            </span>
          </div>
        ) : null}

        {inviteCode ? (
          <div className="rounded-xl border border-canton-muted bg-[var(--card)]/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {t("earnCampaigns.yourCode")}
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-lg font-bold tracking-widest text-canton">
                {inviteCode}
              </p>
              <CopyButton value={inviteCode} label={t("earnCampaigns.copy")} />
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {t("earnCampaigns.saveCodeWarn")}
            </p>
          </div>
        ) : null}
      </div>

      {/* How to use — only for code rewards, self-gates when no redeem config. */}
      {inviteCode ? (
        <RewardHowToUse
          inviteCode={inviteCode}
          redeemUrl={redeemUrl}
          redeemInstructions={redeemInstructions}
          className="mt-4"
        />
      ) : null}
    </div>
  );
}

function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className={cn(
        buttonVariants({ size: "sm" }),
        "shrink-0",
        copied && "brightness-95",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
        </>
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
