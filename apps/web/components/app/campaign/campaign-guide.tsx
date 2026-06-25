"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";

/**
 * Compact "How to join" banner with a "See details" button that opens a modal.
 *
 * The banner is a single line:
 *   "To join this event, lock 30 CC or spend 500 pts. See details"
 *
 * The modal shows both access paths in ONE combined card.
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

/** Guide modal — both access paths in a single combined card. */
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
      <div className="relative w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0a0c14] p-6 shadow-2xl shadow-black/50 sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-2xl p-2 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div>
          <h2 id={titleId} className="text-base font-bold text-white">
            How to join
          </h2>
          <p className="text-[11px] font-medium text-slate-500">
            Eligibility to participate
          </p>
        </div>

        {/* ── Access paths — ONE combined card ───────────────────── */}
        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Access — choose one
          </p>

          {/* Option 1: Lock CC */}
          <div className="mt-3">
            <p className="text-xs leading-relaxed text-slate-300">
              Lock{" "}
              <Link
                href="/wallet"
                onClick={onClose}
                className="font-bold text-emerald-300 underline-offset-2 hover:underline"
              >
                {ccLockAmount} CC
              </Link>{" "}
              on-chain. Your points stay untouched — CC unlocks after the term ends.
            </p>
          </div>

          {/* Divider */}
          <div className="my-3 flex items-center gap-2.5">
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              or
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {/* Option 2: Spend Points */}
          <div>
            <p className="text-xs leading-relaxed text-slate-300">
              Spend{" "}
              <Link
                href="/quests"
                onClick={onClose}
                className="font-bold text-violet-300 underline-offset-2 hover:underline"
              >
                {entryCostPoints.toLocaleString()} pts
              </Link>{" "}
              from your balance. No CC lock needed — deducted once per campaign.
            </p>
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
          Access is checked once per campaign — on the first task you submit. If you
          qualify via CC lock, points are never spent.
        </p>
      </div>
    </div>
  );
}
