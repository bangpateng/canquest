"use client";

import { useState } from "react";
import { Check, Copy, Sparkles, Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { RewardHowToUse } from "@/components/app/campaign/reward-how-to-use";
import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { getRewardConfig } from "@/lib/quest/quest-engine";
import { formatRewardAmount } from "@/lib/canton/campaign-reward";
import { normalizeRewardToken } from "@/lib/quest/quest-types";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";

/**
 * Satu card reveal hadiah setelah claim berhasil — konsisten untuk semua tipe
 * reward (Code, CC, CC+Code). Bersih: header teks (tanpa icon box), baris code +
 * tombol copy (tanpa kotak), lalu "How to use your code" menyatu di card yang sama.
 */
export function RewardReveal({
  inviteCode,
  rewardCc,
  rewardType,
  rewardToken,
  redeemUrl,
  redeemInstructions,
  className,
}: {
  /** Kode invite yang di-reveal (boleh null bila reward hanya CC). */
  inviteCode?: string | null;
  /** Jumlah CC yang dikirim (boleh null/0 bila reward hanya kode). */
  rewardCc?: number | null;
  /** Tipe reward — menentukan icon header (Code/Waitlist = Ticket, CC = CC logo). */
  rewardType?: string | null;
  /** Token reward: "CC" (default) atau "USDCx". */
  rewardToken?: string | null;
  /** Link register/landing proyek (shown in "How to use" section). */
  redeemUrl?: string | null;
  /** Instruksi custom redeem; kosong = pakai template 3-step default. */
  redeemInstructions?: string | null;
  className?: string;
}) {
  const t = usePlatformT();

  if (!inviteCode && !rewardCc) return null;

  // Icon header menyesuaikan tipe reward — sumber kebenaran tunggal:
  // resolveIconKind() di quest-engine, sama seperti card/row/sidebar.
  //  - CC token              → CC reward logo
  //  - Waitlist email        → Sparkles (icon waitlist)
  //  - Code                  → Ticket (icon code)
  //  - CC + Code (dual)      → CC logo + Ticket (kedua reward tampil)
  const config = getRewardConfig(rewardType);
  const token = normalizeRewardToken(rewardToken);
  const isDual = config.isDual;
  const isCcOnly = config.isCcToken && !inviteCode;
  const isWaitlist = config.code === "WAITLIST_EMAIL";

  return (
    <Card
      bare
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-[rgb(var(--canton-rgb)/0.28)] bg-[var(--card)] p-[22px] pb-5 shadow-[0_24px_50px_-28px_rgba(22,36,27,0.45)]",
        className,
      )}
    >
      {/* Glow dekoratif pojok — aura reward (mockup v2) */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-6 -top-6 h-[140px] w-[140px] rounded-full bg-[radial-gradient(circle,rgb(var(--canton-rgb)/0.22),transparent_70%)]"
      />

      {/* Kicker — badge "Reward unlocked" dengan dot berdenyut */}
      <span className="relative inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--canton-rgb)/0.35)] bg-white/70 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-canton dark:bg-[var(--card)]/70">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
        </span>
        Reward unlocked
      </span>

      {/* Header */}
      <div className="relative mt-3.5 flex items-start gap-3">
        {isDual ? (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center gap-0.5 rounded-[14px] bg-gradient-to-br from-[#d9f99d] to-[#86efac] text-[#14532d] shadow-[0_8px_16px_-10px_rgba(74,222,128,0.7)]">
            <RewardTokenLogo token={token} size={16} />
            <Ticket className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </span>
        ) : (
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] shadow-[0_8px_16px_-10px_rgba(74,222,128,0.7)]",
              isCcOnly
                ? "bg-gradient-to-br from-[#d9f99d] to-[#86efac] text-[#14532d]"
                : isWaitlist
                  ? "bg-gradient-to-br from-cyan-100 to-cyan-300 text-cyan-800"
                  : "bg-gradient-to-br from-[#d9f99d] to-[#86efac] text-[#14532d]",
            )}
          >
            {isCcOnly ? (
              <RewardTokenLogo token={token} size={20} />
            ) : isWaitlist ? (
              <Sparkles className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            ) : (
              <Ticket className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            )}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-[var(--foreground)]">
            {t("earnCampaigns.congratsTitle")}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-[var(--muted-foreground)]">
            {t("earnCampaigns.rewardsReady")}
          </p>
        </div>
      </div>

      {/* Reward rows */}
      <div className="relative mt-4 space-y-4">
        {rewardCc ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-lg font-bold tabular-nums text-canton">
              +{formatRewardAmount(rewardCc, normalizeRewardToken(rewardToken))}{" "}
              <TokenUsdValue amount={rewardCc} token={token} />
            </p>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              {t("earnCampaigns.ccSentToWallet")}
            </span>
          </div>
        ) : null}

        {inviteCode ? (
          <div>
            {/* Tiket gelap dengan notch kiri-kanan (mockup v2) */}
            <div className="relative rounded-2xl bg-[#0f1a14] px-4 pb-3.5 pt-4 text-[#ecfdf3]">
              <span
                aria-hidden
                className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[var(--card)]"
              />
              <span
                aria-hidden
                className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[var(--card)]"
              />
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a7f3d0]/70">
                {t("earnCampaigns.yourCode")}
              </p>
              <div className="flex items-center justify-between gap-2.5">
                <p className="min-w-0 break-all font-mono text-[15px] font-bold tracking-[0.08em] text-white">
                  {inviteCode}
                </p>
                <TicketCopyButton value={inviteCode} />
              </div>
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
          className="relative mt-4 border-t border-[var(--border)] pt-4"
          flat
        />
      ) : null}
    </Card>
  );
}

/** Copy icon-only utk tiket (mockup v2) — state "copied" hijau. */
function TicketCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy code"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20",
        copied && "border-[#86efac]/40 text-[#86efac]",
      )}
    >
      {copied ? (
        <Check className="h-[15px] w-[15px]" aria-hidden />
      ) : (
        <Copy className="h-[15px] w-[15px]" aria-hidden />
      )}
    </button>
  );
}

