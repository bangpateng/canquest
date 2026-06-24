"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Coins,
  Info,
  KeyRound,
  ListChecks,
  Lock,
  Wallet,
  X,
} from "lucide-react";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";
import { cn } from "@/lib/utils/utils";

/**
 * Compact "How to join" banner with a "Details" button that opens a modal
 * containing the full structured guide.
 *
 * The banner is a single line:
 *   "To join this event, lock 30 CC or spend 500 pts. [Details]"
 *
 * Placed right below the reward sidebar on the campaign detail page.
 */
export function CampaignGuide() {
  const { entryCostPoints, ccLockAmount } = useEarnAccessConfig();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <p className="flex-1 text-xs leading-relaxed text-slate-300">
          To join this event, lock{" "}
          <span className="font-semibold text-amber-300">{ccLockAmount} CC</span> or spend{" "}
          <span className="font-semibold text-violet-300">
            {entryCostPoints.toLocaleString()} pts
          </span>
          .{" "}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-semibold text-[var(--primary)] underline-offset-2 hover:underline"
          >
            See details
          </button>
        </p>
      </div>

      <GuideModal
        open={open}
        onClose={() => setOpen(false)}
        entryCostPoints={entryCostPoints}
        ccLockAmount={ccLockAmount}
      />
    </>
  );
}

/** Full structured guide inside a modal. */
function GuideModal({
  open,
  onClose,
  entryCostPoints,
  ccLockAmount,
}: {
  open: boolean;
  onClose: () => void;
  entryCostPoints: number;
  ccLockAmount: number;
}) {
  const titleId = useId();

  // Scroll-lock body + Esc to close while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-3xl border border-white/[0.08] bg-[#0a0c14] p-6 shadow-2xl shadow-black/50 sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-2xl p-2 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/20">
            <KeyRound className="h-4 w-4 text-[var(--primary)]" aria-hidden />
          </span>
          <div>
            <h2 id={titleId} className="text-base font-bold text-white">
              How to join
            </h2>
            <p className="text-[11px] font-medium text-slate-500">
              Eligibility &amp; steps to participate
            </p>
          </div>
        </div>

        {/* ── Access paths ────────────────────────────────────────── */}
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Access — choose one
        </p>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-400" aria-hidden />
              <span className="text-xs font-bold text-emerald-300">Lock CC</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              Lock{" "}
              <span className="font-bold text-emerald-300">{ccLockAmount} CC</span> on-chain.
              Your points stay untouched — CC unlocks after the term ends.
            </p>
            <Link
              href="/wallet"
              onClick={onClose}
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <Wallet className="h-3.5 w-3.5" />
              Lock in Wallet
            </Link>
          </div>

          <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-3.5">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-violet-400" aria-hidden />
              <span className="text-xs font-bold text-violet-300">Spend Points</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              Spend{" "}
              <span className="font-bold text-violet-300">
                {entryCostPoints.toLocaleString()} pts
              </span>{" "}
              from your balance. No CC lock needed — deducted once per campaign.
            </p>
            <Link
              href="/quests"
              onClick={onClose}
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 transition-colors hover:text-violet-300"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Earn points in Quest
            </Link>
          </div>
        </div>

        {/* ── Steps ───────────────────────────────────────────────── */}
        <div className="mt-5 border-t border-white/[0.05] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Steps
          </p>
          <ol className="mt-2.5 space-y-2.5">
            {[
              {
                t: "Create your Canton wallet",
                d: "Required to lock CC, spend points, and receive rewards.",
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
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[10px] font-bold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
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

        <p className="mt-4 border-t border-white/[0.05] pt-3 text-[10px] leading-relaxed text-slate-600">
          Access is checked once per campaign — on the first task you submit. If you qualify
          via CC lock, points are never spent.
        </p>
      </div>
    </div>
  );
}
