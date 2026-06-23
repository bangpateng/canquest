"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useLockStatus } from "@/lib/hooks/use-lock-status";

/**
 * CC Lock gate untuk halaman Earn (Spec BAGIAN 5d).
 * Render banner saat tier !== FULL (user belum kunci ≥30 CC). Tombol Join yang sebenarnya
 * dinonaktifkan tidak di-sentuh di sini — guard backend (ForbiddenException) sudah menolak
 * submit dengan pesan jelas; banner ini memberi konteks + CTA sebelum user klik.
 *
 * Tidak render apa pun saat tier === FULL (aman ikut event).
 */
export function CampaignLockGate() {
  const { status } = useLockStatus({ enabled: true, pollIntervalMs: 90_000 });

  if (status.tier === "FULL") return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
      <Lock className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
      <p className="flex-1 text-sm font-medium text-slate-200">
        Kunci 30 CC untuk ikut event
      </p>
      <Link
        href="/wallet"
        className="shrink-0 rounded-xl border border-emerald-500/60 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-all hover:bg-emerald-500/10"
      >
        Lock CC
      </Link>
    </div>
  );
}
