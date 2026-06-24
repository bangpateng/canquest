"use client";

import Link from "next/link";
import { BookOpen, Coins, ListChecks, Lock, Sparkles, Wallet } from "lucide-react";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";
import { surfaceCardClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

/**
 * Card "How to join" untuk halaman detail campaign Earn.
 * Menjelaskan 2 jalur akses (lock CC / spend points), langkah ikut, dan syarat eligibility.
 * Biaya points + jumlah CC lock di-fetch dinamis dari backend (bisa diubah admin tanpa deploy).
 */
export function CampaignGuide() {
  const { entryCostPoints, ccLockAmount } = useEarnAccessConfig();

  return (
    <section
      className={cn(
        surfaceCardClass,
        "overflow-hidden bg-[#0a0c14]/80 p-5 sm:p-6",
      )}
      aria-label="How to join this event"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/20">
          <BookOpen className="h-4 w-4 text-[var(--primary)]" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-bold text-white">How to join</h2>
          <p className="text-[11px] font-medium text-slate-500">
            Eligibility &amp; steps to participate
          </p>
        </div>
      </div>

      {/* Eligibility — 2 jalur akses */}
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Eligibility — pilih salah satu
        </p>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          {/* Jalur 1: Lock CC */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-400" aria-hidden />
              <span className="text-xs font-bold text-emerald-300">Option 1 · Lock CC</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
              Lock{" "}
              <span className="font-bold text-emerald-300">
                {ccLockAmount} CC
              </span>{" "}
              on-chain. Your points are not spent — CC returns after the lock term ends.
            </p>
            <Link
              href="/wallet"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <Wallet className="h-3.5 w-3.5" />
              Lock in Wallet
            </Link>
          </div>

          {/* Jalur 2: Spend Points */}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" aria-hidden />
              <span className="text-xs font-bold text-violet-300">Option 2 · Spend Points</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
              Spend{" "}
              <span className="font-bold text-violet-300">
                {entryCostPoints.toLocaleString()} pts
              </span>{" "}
              from your quest/earn balance. No CC lock required.
            </p>
            <Link
              href="/quests"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 transition-colors hover:text-violet-300"
            >
              <Coins className="h-3.5 w-3.5" />
              Earn points in Quest
            </Link>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Don&apos;t have either? You can&apos;t join yet — lock CC or earn more points first.
          Access is checked once per campaign (first task you submit).
        </p>
      </div>

      {/* Steps */}
      <div className="mt-5 border-t border-white/[0.05] pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          Steps
        </p>
        <ol className="mt-2.5 space-y-2">
          {[
            {
              t: "Create your Canton wallet",
              d: "Required to lock CC or receive rewards.",
            },
            {
              t: "Meet eligibility above",
              d: `Lock ${ccLockAmount} CC or hold ≥ ${entryCostPoints.toLocaleString()} net points.`,
            },
            {
              t: "Complete all missions",
              d: "Submit each task — some verify instantly, others need review.",
            },
            {
              t: "Claim your reward",
              d: "Once all tasks are done, claim CC / invite code per the reward type.",
            },
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[10px] font-bold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200">{step.t}</p>
                <p className="text-[11px] leading-relaxed text-slate-500">{step.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
