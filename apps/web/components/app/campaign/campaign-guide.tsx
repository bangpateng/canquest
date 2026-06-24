"use client";

import Link from "next/link";
import { Coins, KeyRound, ListChecks, Lock, Wallet } from "lucide-react";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";
import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { surfaceCardClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

/**
 * "How to join" card — shown below the reward sidebar on the campaign detail page.
 *
 * Single compact card with:
 *   1. Live eligibility status (which path the user currently qualifies for)
 *   2. Two access paths explained (lock CC / spend points)
 *   3. Numbered steps from wallet creation to reward claim
 *
 * Costs (points + CC lock amount) are fetched live from the backend so they stay
 * accurate when an admin changes the config.
 */
export function CampaignGuide() {
  const { entryCostPoints, ccLockAmount } = useEarnAccessConfig();
  const { status: lockStatus } = useLockStatus({ enabled: true, pollIntervalMs: 90_000 });

  const hasCcLock = lockStatus.tier === "FULL";

  return (
    <section
      className={cn(surfaceCardClass, "bg-[#0a0c14]/80 p-4 sm:p-5")}
      aria-label="How to join this event"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
        <h2 className="text-sm font-bold text-white">How to join</h2>
      </div>

      {/* ── Access paths ──────────────────────────────────────────── */}
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Access — choose one
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {/* Path 1: Lock CC */}
        <div
          className={cn(
            "rounded-xl border p-3 transition-colors",
            hasCcLock
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-white/[0.06] bg-white/[0.02]",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              <span className="text-xs font-bold text-slate-200">Lock CC</span>
            </div>
            {hasCcLock ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                Active
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Lock{" "}
            <span className="font-bold text-emerald-300">{ccLockAmount} CC</span> on-chain.
            Your points stay untouched — CC unlocks after the term ends.
          </p>
          {!hasCcLock ? (
            <Link
              href="/wallet"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <Wallet className="h-3 w-3" />
              Lock in Wallet
            </Link>
          ) : null}
        </div>

        {/* Path 2: Spend Points */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-violet-400" aria-hidden />
            <span className="text-xs font-bold text-slate-200">Spend Points</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Spend{" "}
            <span className="font-bold text-violet-300">
              {entryCostPoints.toLocaleString()} pts
            </span>{" "}
            from your balance. No CC lock needed — points are deducted once per campaign.
          </p>
          <Link
            href="/quests"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 transition-colors hover:text-violet-300"
          >
            <ListChecks className="h-3 w-3" />
            Earn points in Quest
          </Link>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        No wallet, no lock, and fewer than {entryCostPoints.toLocaleString()} points? You
        can&apos;t join yet — create a wallet and earn points first.
      </p>

      {/* ── Steps ─────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-white/[0.05] pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Steps
        </p>
        <ol className="mt-2 space-y-1.5">
          {[
            {
              t: "Create your Canton wallet",
              d: "Required to lock CC, spend points, and receive rewards.",
            },
            {
              t: "Meet the access requirement",
              d: `Lock ${ccLockAmount} CC, or hold at least ${entryCostPoints.toLocaleString()} net points.`,
            },
            {
              t: "Complete every mission",
              d: "Submit each task — some verify instantly, others need admin review.",
            },
            {
              t: "Claim your reward",
              d: "After all tasks are verified, claim your CC or invite code.",
            },
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[9px] font-bold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-200">{step.t}</p>
                <p className="text-[10px] leading-snug text-slate-500">{step.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-3 border-t border-white/[0.05] pt-2.5 text-[10px] leading-relaxed text-slate-600">
        Access is checked once per campaign — on the first task you submit. If you qualify
        via CC lock, points are never spent.
      </p>
    </section>
  );
}
