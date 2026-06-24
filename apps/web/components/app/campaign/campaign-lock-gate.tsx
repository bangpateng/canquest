"use client";

import { Info } from "lucide-react";
import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { useEarnAccessConfig } from "@/lib/hooks/use-earn-access-config";

/**
 * Banner ringkas di atas task panel: pengingat syarat akses Earn.
 * Hanya tampil saat user BELUM tier FULL (belum lock CC cukup).
 * Catatan: jalur points juga valid — banner ini mengarah ke card guide untuk detail.
 */
export function CampaignLockGate() {
  const { status } = useLockStatus({ enabled: true, pollIntervalMs: 90_000 });
  const { entryCostPoints, ccLockAmount } = useEarnAccessConfig();

  // User sudah lock CC cukup → jalur cc_lock aktif, tidak perlu banner.
  if (status.tier === "FULL") return null;

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
      <p className="flex-1 text-xs leading-relaxed text-slate-300">
        To join this event, lock{" "}
        <span className="font-semibold text-amber-300">{ccLockAmount} CC</span>{" "}
        or spend{" "}
        <span className="font-semibold text-violet-300">
          {entryCostPoints.toLocaleString()} pts
        </span>
        . See the guide below for details.
      </p>
    </div>
  );
}
