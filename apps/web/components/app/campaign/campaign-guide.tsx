"use client";

import Link from "next/link";
import { BookOpen, Coins, Lock } from "lucide-react";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";
import { surfaceCardClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

/**
 * Card ringkas "How to join" — diletakkan di bawah sidebar reward.
 * Satu card padat: 2 jalur akses (lock CC / spend points) + ringkasan langkah.
 * Biaya points + jumlah CC lock di-fetch dinamis dari backend.
 */
export function CampaignGuide() {
  const { entryCostPoints, ccLockAmount } = useEarnAccessConfig();

  return (
    <section
      className={cn(surfaceCardClass, "bg-[#0a0c14]/80 p-4 sm:p-5")}
      aria-label="How to join this event"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          How to join
        </h2>
      </div>

      {/* 2 jalur akses — 1 baris, ringkas */}
      <p className="mt-2.5 text-[11px] font-semibold text-slate-500">
        Eligibility — pilih salah satu:
      </p>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
          <p className="text-[11px] leading-tight text-slate-300">
            Lock{" "}
            <Link href="/wallet" className="font-bold text-emerald-300 hover:underline">
              {ccLockAmount} CC
            </Link>{" "}
            <span className="text-slate-500">(points aman)</span>
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/[0.05] px-3 py-2">
          <Coins className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
          <p className="text-[11px] leading-tight text-slate-300">
            Spend{" "}
            <Link href="/quests" className="font-bold text-violet-300 hover:underline">
              {entryCostPoints.toLocaleString()} pts
            </Link>{" "}
            <span className="text-slate-500">(tanpa lock)</span>
          </p>
        </div>
      </div>

      {/* Langkah — 1 baris inline, sangat ringkas */}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-400">Steps:</span>{" "}
        Create wallet → meet eligibility above → complete all missions → claim reward.
      </p>
    </section>
  );
}
