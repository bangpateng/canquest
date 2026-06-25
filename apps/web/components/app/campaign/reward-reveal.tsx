"use client";

import { cn } from "@/lib/utils/utils";

/**
 * Blok tampilan "reveal" hadiah setelah claim berhasil — konsisten untuk semua
 * tipe reward. Sebelumnya kode invite-code ditampilkan dalam 3 desain berbeda
 * (violet di quest-submit-section, canton di raffle-claim, inline di tempat lain).
 * Sekarang satu komponen, desain canton-consistent.
 */
export function RewardReveal({
  inviteCode,
  rewardCc,
  className,
}: {
  /** Kode invite yang di-reveal (boleh null bila reward hanya CC). */
  inviteCode?: string | null;
  /** Jumlah CC yang dikirim (boleh null/0 bila reward hanya kode). */
  rewardCc?: number | null;
  className?: string;
}) {
  if (!inviteCode && !rewardCc) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-canton-muted bg-canton-subtle p-4",
        className,
      )}
    >
      {rewardCc ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            CC reward
          </p>
          <p className="font-mono text-lg font-bold tabular-nums text-canton">
            {rewardCc} CC
          </p>
        </div>
      ) : null}
      {inviteCode ? (
        <div className={rewardCc ? "mt-3 border-t border-canton-muted pt-3" : ""}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Your Invite Code
          </p>
          <p className="mt-2 font-mono text-lg font-bold tracking-widest text-canton">
            {inviteCode}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Save this code — it will not be shown again after you leave this page.
          </p>
        </div>
      ) : null}
    </div>
  );
}
