"use client";

import { useCallback, useState } from "react";

import { displayName } from "@/components/app/wallet/token-logo";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { useMe } from "@/lib/hooks/use-me";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";

/**
 * Aksi offer bersama: satu implementasi untuk modal Offers dan detail offer.
 *
 * Dua mode mengikuti jenis wallet user (diputuskan dari /api/me, bukan prop):
 *  - external (non-custodial) → tanda tangan di browser lewat signing relay
 *  - internal (custodial)     → POST endpoint API; backend yang sign
 *
 * Sebelumnya logika ini hanya hidup di dalam modal Offers. Detail offer perlu
 * aksi yang persis sama, jadi dipindah ke sini agar tidak ada dua jalur
 * tanda tangan yang bisa menyimpang (sumber bug "sudah accept tapi status
 * tidak berubah").
 */

export type OfferAction = "accept" | "reject" | "withdraw";

/** Minimal info yang dibutuhkan untuk menjalankan aksi — dipenuhi OfferItem
 *  (modal Offers) maupun PendingOfferDetail (detail offer). */
export type OfferActionTarget = {
  contractId: string;
  /** Jenis kontrak CIP-0056 vs legacy — dikirim ke endpoint accept/reject. */
  type?: "transfer_offer" | "transfer_instruction";
  /** Instrument untuk label nominal (mis. "Amulet" / "USDCx"). */
  instrumentId?: string;
  /** Nominal mentah (string desimal). */
  amount?: string;
  /** Untuk modal Offers: dipakai optimistic-remove dari list lokal. */
  senderLabel?: string;
  receiverLabel?: string;
  sender?: string;
  receiver?: string;
};

export type OfferActionOutcome = {
  /** Pesan sukses dari server (fallback: kalimat standar). */
  message: string;
  action: OfferAction;
};

type UseOfferActionsOptions = {
  /** Dipanggil saat aksi sukses — dipakai optimistic-remove dari list. */
  onSuccess?: (action: OfferAction, contractId: string) => void;
};

export function useOfferActions(options: UseOfferActionsOptions = {}) {
  const { onSuccess } = options;
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
  const tx = useTransactionStatus();
  // Aksi yang sedang berjalan (contractId) — untuk disable tombol + spinner.
  const [processing, setProcessing] = useState<{
    id: string;
    action: OfferAction;
  } | null>(null);

  const run = useCallback(
    async (
      action: OfferAction,
      target: OfferActionTarget,
    ): Promise<OfferActionOutcome | null> => {
      const token = displayName(target.instrumentId ?? "Amulet");
      const amountNum = Number(target.amount ?? "0");
      const amountText = Number.isFinite(amountNum)
        ? `${amountNum.toFixed(4)} ${token}`
        : token;
      // Label pihak lawan: untuk withdraw → penerima; selain itu → pengirim.
      const counterpartyLabel =
        action === "withdraw"
          ? (target.receiverLabel ?? target.receiver ?? "recipient")
          : (target.senderLabel ?? target.sender ?? "sender");
      const labels = {
        accept: {
          verb: "Accept",
          title: "Transfer accepted",
          subtitle: `${token} added to your wallet.`,
        },
        reject: {
          verb: "Reject",
          title: "Transfer rejected",
          subtitle: "Returned to sender.",
        },
        withdraw: {
          verb: "Withdraw",
          title: "Transfer cancelled",
          subtitle: `${token} returned to your wallet.`,
        },
      } as const;
      const subText =
        action === "withdraw"
          ? `to ${counterpartyLabel}`
          : `from ${counterpartyLabel}`;

      setProcessing({ id: target.contractId, action });
      try {
        if (isExternalWallet) {
          await signRelayTransaction(
            action === "accept"
              ? "accept_offer"
              : action === "reject"
                ? "reject_offer"
                : "withdraw_offer",
            { contractId: target.contractId },
            {
              onWalletLocked: () =>
                promptPassphrase(`${labels[action].verb} ${amountText}`),
            },
          );
          tx.succeed({
            amountText,
            title: labels[action].title,
            subtitle: labels[action].subtitle,
            meta: [
              { label: "Amount", value: amountText },
              {
                label: action === "withdraw" ? "To" : "From",
                value: counterpartyLabel,
                mono: true,
              },
              { label: "Network", value: "Canton" },
            ],
          });
          onSuccess?.(action, target.contractId);
          return {
            action,
            message:
              action === "accept"
                ? `Transfer accepted — ${token} added to your wallet.`
                : action === "reject"
                  ? `Transfer rejected — ${token} returned to sender.`
                  : `Transfer cancelled — ${token} returned to your wallet.`,
          };
        }

        tx.startBroadcast({
          amountText,
          subText,
          title: labels[action].title,
          subtitle: labels[action].subtitle,
          accentBg: "bg-[var(--primary)]/15",
          accentText: "text-canton",
        });
        const endpoint =
          action === "accept"
            ? "/api/party/offers/accept"
            : action === "reject"
              ? "/api/party/offers/reject"
              : "/api/party/transfer-instruction/withdraw";
        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "withdraw"
              ? { transferInstructionCid: target.contractId }
              : {
                  contractId: target.contractId,
                  type: target.type ?? "transfer_offer",
                },
          ),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (!res.ok || !data.ok) {
          tx.fail(data.message ?? `Failed to ${action} transfer.`);
          return null;
        }
        tx.succeed({
          amountText,
          title: labels[action].title,
          subtitle: labels[action].subtitle,
          meta: [
            { label: "Amount", value: amountText },
            {
              label: action === "withdraw" ? "To" : "From",
              value: counterpartyLabel,
              mono: true,
            },
            { label: "Network", value: "Canton" },
          ],
        });
        onSuccess?.(action, target.contractId);
        return {
          action,
          message:
            data.message ??
            (action === "accept"
              ? `Transfer accepted — ${token} added to your wallet.`
              : action === "reject"
                ? `Transfer rejected — ${token} returned to sender.`
                : `Transfer cancelled — ${token} returned to your wallet.`),
        };
      } catch (err) {
        tx.fail(
          err instanceof Error && err.message
            ? err.message
            : "Network error. Check your connection and try again.",
        );
        return null;
      } finally {
        setProcessing(null);
      }
    },
    [isExternalWallet, promptPassphrase, tx, onSuccess],
  );

  return { run, processing, passphraseModal };
}
