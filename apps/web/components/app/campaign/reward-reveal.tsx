"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { RewardHowToUse } from "@/components/app/campaign/reward-how-to-use";

/**
 * Satu card reveal hadiah setelah claim berhasil — konsisten untuk semua tipe
 * reward (Code, CC, CC+Code). Bersih: header teks (tanpa icon box), baris code +
 * tombol copy (tanpa kotak), lalu "How to use your code" menyatu di card yang sama.
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
      {/* Header — teks saja, tanpa icon box */}
      <div>
        <p className="text-base font-bold text-[var(--foreground)]">
          {t("earnCampaigns.congratsTitle")}
        </p>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {t("earnCampaigns.rewardsReady")}
        </p>
      </div>

      {/* Reward rows */}
      <div className="mt-4 space-y-4">
        {rewardCc ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-lg font-bold tabular-nums text-canton">
              +{rewardCc} CC
            </p>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              {t("earnCampaigns.ccSentToWallet")}
            </span>
          </div>
        ) : null}

        {inviteCode ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {t("earnCampaigns.yourCode")}
            </p>
            <div className="mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-xl font-bold tracking-widest text-canton">
                {inviteCode}
              </p>
              <CopyButton value={inviteCode} label={t("earnCampaigns.copy")} />
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {t("earnCampaigns.saveCodeWarn")}
            </p>
          </div>
        ) : null}
      </div>

      {/* How to use — menyatu di card yang sama; self-gate bila tidak ada config redeem. */}
      {inviteCode ? (
        <RewardHowToUse
          inviteCode={inviteCode}
          redeemUrl={redeemUrl}
          redeemInstructions={redeemInstructions}
          className="mt-4 border-t border-canton-muted pt-4"
          flat
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
