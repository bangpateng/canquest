"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/utils";

/**
 * Status bar lock CC — menampilkan jumlah CC terkunci + tier (Full access / none),
 * dengan tombol "Lock" / "Manage" yang membuka CcLockModal.
 *
 * Dipakai di /wallet utama (token-list.tsx). Sebelumnya inline di token-detail-view.tsx
 * (yang sekarang dihapus). Di-extract ke sini supaya reusable + tidak jadi dead code.
 */
export function LockStatusBar({
  status,
  onManage,
}: {
  status: { lockedCc: number; tier: "NONE" | "FULL" };
  onManage: () => void;
}) {
  const hasLock = status.lockedCc > 0;
  const badge =
    status.tier === "FULL"
      ? { label: "Full access", color: "text-emerald-400" }
      : { label: "", color: "text-slate-400" };

  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        {hasLock ? (
          <span className="truncate text-slate-200">
            Locked{" "}
            <span className="font-semibold">{status.lockedCc} CC</span>
            {badge.label && (
              <span className={cn("ml-1.5 font-medium", badge.color)}>
                · {badge.label}
              </span>
            )}
          </span>
        ) : (
          <span className="truncate text-slate-400">No CC locked</span>
        )}
      </div>
      <button
        type="button"
        onClick={onManage}
        className="shrink-0 rounded-xl border border-emerald-500/60 bg-transparent px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/10"
      >
        {hasLock ? "Manage" : "Lock"}
      </button>
    </div>
  );
}
