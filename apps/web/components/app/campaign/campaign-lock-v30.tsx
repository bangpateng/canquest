"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-claim-cta";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";

/**
 * Lock campaign v30 — LockProposal → AcceptLock → LockedAmulet holders=[validator].
 *
 * Elibility jalur lock CC (LOCK-SPEC.md): CC terkunci SAMPAI campaign berakhir
 * (T2); early unlock = eligibility dicabut saat re-verifikasi T1. Tombol unlock
 * ada di wallet (LockedAmulet_OwnerExpireLockV2 — ledger yang menolak sebelum
 * T2, tidak ada logika waktu di sini).
 *
 * Guard saldo (LOCK-SPEC §"sisakan fee"): jumlah lock fixed dari campaign —
 * UI memperingatkan agar sisa saldo bebas tetap ≥ beberapa kali claim fee.
 */

type LockStatusResp = {
  v30: true;
  record: {
    exists: boolean;
    status: string | null;
    amountCc: number | null;
    expiresAt: string | null;
    proposalExpiresAt: string | null;
    proposalWindowOpen: boolean;
    canRequest: boolean;
    unlockedAt: string | null;
  };
  eligible: boolean;
};

export function CampaignLockV30Section({
  questId,
  partyId,
  entryCcLock,
  onLocked,
}: {
  questId: string;
  partyId: string | null;
  entryCcLock?: number | null;
  onLocked: () => void;
}) {
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
  const [status, setStatus] = useState<LockStatusResp | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/quests/${questId}/lock-v30/status`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as LockStatusResp;
      if (data?.v30) setStatus(data);
    } catch {
      /* best-effort */
    }
  }, [questId]);

  useEffect(() => {
    if (partyId) void loadStatus();
  }, [partyId, loadStatus]);

  if (!partyId || !status) return null;

  const amount = status.record.amountCc ?? entryCcLock ?? 30;
  const endsAtLabel = status.record.expiresAt
    ? new Date(status.record.expiresAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  async function handleLock() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      // 1. Backend membuat LockProposal (jendela tanda tangan 10 menit).
      const createRes = await fetch(`/api/quests/${questId}/lock-v30`, {
        method: "POST",
        credentials: "include",
      });
      const created = (await createRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!createRes.ok || created.ok === false) {
        setError(created.error ?? created.message ?? "Could not create lock proposal.");
        return;
      }

      // 2. Browser menandatangani AcceptLock (hash saja — kunci tidak keluar).
      await signRelayTransaction("accept_lock_proposal", { questId }, {
        onWalletLocked: () => promptPassphrase(`Lock ${amount} CC until campaign ends`),
      });

      setSuccess(
        `${amount} CC locked until ${endsAtLabel ?? "the campaign ends"} — you're in.`,
      );
      await loadStatus();
      onLocked();
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "Lock failed — please try again.",
      );
      // Jendela proposal mungkin terlewat — refresh utk status canRequest.
      await loadStatus();
    } finally {
      setIsSubmitting(false);
    }
  }

  // Sudah eligible / sudah lock → tidak perlu section ini.
  if (status.eligible) return null;
  if (status.record.status === "ACCEPTED") return null;
  if (status.record.status === "REVOKED") {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
        Your campaign lock was revoked (early unlock detected). You are no
        longer eligible for this campaign.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {passphraseModal}
      <CampaignClaimCta
        label={`Lock ${amount} CC to join`}
        isSubmitting={isSubmitting}
        error={error}
        success={success}
        onClaim={() => void handleLock()}
      />
      <p className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Locked until the campaign ends{endsAtLabel ? ` (${endsAtLabel})` : ""}. Keep
        some CC free for claim fees — you&apos;ll need roughly 2× the fee after locking.
        If the slots run out before you submit, your CC stays locked until the
        campaign ends — it is not lost, only waiting.
      </p>
    </div>
  );
}
