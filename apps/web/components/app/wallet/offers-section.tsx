"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { ArrowDownLeft, ArrowUpRight, Check, X, Clock, Undo2 } from "lucide-react";
import { queryKeys } from "@/lib/queries/query-keys";
import { displayName } from "@/components/app/wallet/token-logo";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { useMe } from "@/lib/hooks/use-me";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";

export interface OfferItem {
  type: "transfer_offer" | "transfer_instruction";
  contractId: string;
  sender: string;
  senderLabel?: string;
  receiver: string;
  /** Label penerima (di-resolve jadi @username oleh backend). Dipakai tab Sent. */
  receiverLabel?: string;
  amount: string;
  description: string;
  expiresAt?: string;
  createdAt?: string;
  /**
   * Instrument id offer ini (mis. "Amulet" untuk CC, "USDCX" untuk token non-CC).
   * Default "Amulet" bila tidak ada (legacy). Dipakai render label token yang benar,
   * bukan hardcoded "CC".
   */
  instrumentId?: string;
  /** Admin party instrument (mis. "DSO::1220..."). Kosong untuk legacy. */
  instrumentAdmin?: string;
  // legacy compat
  amountCc?: number;
  trackingId?: string;
}

interface OffersResponse {
  offers: OfferItem[];
  total?: number;
  legacyCount?: number;
  // legacy compat
  count?: number;
  message?: string;
}

export function formatAmount(offer: OfferItem): string {
  // New format: amount as string (e.g. "5.0000000000")
  if (offer.amount && offer.amount !== "0") {
    const num = parseFloat(offer.amount);
    if (!isNaN(num)) return num.toFixed(4);
  }
  // Legacy format: amountCc as number
  if (typeof offer.amountCc === "number" && offer.amountCc > 0) {
    return offer.amountCc.toFixed(4);
  }
  return "0.0000";
}

export function senderDisplay(offer: OfferItem): string {
  if (offer.senderLabel) return offer.senderLabel;
  if (offer.sender?.includes("::")) return offer.sender.split("::")[0]!;
  return offer.sender || "unknown";
}

/**
 * Label penerima untuk tab Sent (outgoing offers). Mirror dari senderDisplay:
 * pakai receiverLabel (di-resolve backend), fallback ke party hint.
 */
export function receiverDisplay(offer: OfferItem): string {
  if (offer.receiverLabel) return offer.receiverLabel;
  if (offer.receiver?.includes("::")) return offer.receiver.split("::")[0]!;
  return offer.receiver || "unknown";
}

/**
 * Hook: fetch & re-fetch pending incoming offers.
 * Dipakai oleh badge tombol "Offers" (count) dan modal Offers.
 *
 * Di-back TanStack Query: real-time via SSE `offer:new` (lihat use-realtime.ts),
 * refetch saat tab focus/reconnect, cache global di-dedup. Safety-net polling
 * 5 menit kalau SSE putus.
 *
 * refresh() mengembalikan jumlah offer setelah fetch — berguna untuk
 * pemilik tombol (wallet-actions) agar tahu apakah perlu menampilkan badge.
 * setOffers tetap disediakan untuk optimistic remove lokal (accept/reject).
 */
/**
 * Internal hook parameterized — dipakai useOffers (incoming) + useSentOffers
 * (outgoing). Sebelumnya 2 hook nyaris identik (~120 barang duplikat).
 * Sekarang 1 implementasi, 2 thin wrapper dengan return shape yang sama
 * persis (caller gak perlu diubah).
 */
function useOffersList(options: {
  queryKey: readonly unknown[];
  /** Query param untuk direction: '' (incoming/default) atau '?direction=outgoing'. */
  directionParam: string;
}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: options.queryKey,
    queryFn: async (): Promise<{ items: OfferItem[]; error: string | null }> => {
      try {
        const res = await fetch(`/api/party/offers${options.directionParam}`, {
          credentials: "include",
        });
        const data = (await res.json()) as OffersResponse;
        if (!res.ok) {
          return {
            items: [],
            error: data.message ?? `Server error (HTTP ${res.status}).`,
          };
        }
        return { items: data.offers ?? [], error: null };
      } catch {
        return { items: [], error: "Network error. Check your connection." };
      }
    },
    staleTime: 30_000,
    // Real-time via SSE `offer:new` (lihat use-realtime.ts). Safety-net polling
    // 5 menit kalau SSE putus (network glitch, browser sleep). refetchOnWindowFocus
    // sengaja OFF (global) — SSE + polling sudah jadi sumber update, alt-tab tidak
    // perlu trigger burst request.
    refetchInterval: 300_000,
    retry: 2,
  });

  const data = query.data;
  const items = data?.items ?? [];
  const error = data?.error ?? null;

  /** Optimistic remove lokal (accept/reject) — update cache react-query. */
  const setOffers = useCallback(
    (updater: (prev: OfferItem[]) => OfferItem[]) => {
      queryClient.setQueryData<{ items: OfferItem[]; error: string | null } | undefined>(
        options.queryKey,
        (prev) => {
          const items = prev?.items ?? [];
          return { items: updater(items), error: null };
        },
      );
    },
    [queryClient, options.queryKey],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: options.queryKey });
    const latest = queryClient.getQueryData<{ items: OfferItem[] } | undefined>(
      options.queryKey,
    );
    return latest?.items.length ?? 0;
  }, [queryClient, options.queryKey]);

  return { items, loading: query.isPending, error, refresh, setOffers };
}

export function useOffers() {
  const { items, loading, error, refresh, setOffers } = useOffersList({
    queryKey: queryKeys.party.offers,
    directionParam: "",
  });
  return { offers: items, loading, error, refresh, setOffers };
}

/**
 * Hook: fetch & re-fetch OUTGOING (sent) pending offers — dipakai tab Sent
 * di modal Offers (tombol Withdraw). Mirror useOffers tapi query key terpisah
 * (queryKeys.party.sentOffers) + fetch ?direction=outgoing.
 */
export function useSentOffers() {
  const { items, loading, error, refresh, setOffers } = useOffersList({
    queryKey: queryKeys.party.sentOffers,
    directionParam: "?direction=outgoing",
  });
  return {
    sentOffers: items,
    loading,
    error,
    refresh,
    setOffers,
  };
}

/**
 * Remove satu offer dari list lokal (setelah accept/reject/withdraw sukses).
 */
export function removeOfferLocally(
  setOffers: (updater: (prev: OfferItem[]) => OfferItem[]) => void,
  contractId: string,
) {
  setOffers((prev) => prev.filter((o) => o.contractId !== contractId));
}

// ── MODAL ─────────────────────────────────────────────────────────────────

export interface OffersModalProps {
  open: boolean;
  onClose: () => void;
  offers: OfferItem[];
  loading: boolean;
  error: string | null;
  setOffers: (updater: (prev: OfferItem[]) => OfferItem[]) => void;
  onRefresh?: () => void;
  /** Outgoing (sent) pending offers — tab Sent + tombol Withdraw. */
  sentOffers: OfferItem[];
  sentLoading: boolean;
  sentError: string | null;
  setSentOffers: (updater: (prev: OfferItem[]) => OfferItem[]) => void;
  onSentRefresh?: () => void;
}

export function OffersModal({
  open,
  onClose,
  offers,
  loading,
  error,
  setOffers,
  onRefresh,
  sentOffers,
  sentLoading,
  sentError,
  setSentOffers,
  onSentRefresh,
}: OffersModalProps) {
  const [activeTab, setActiveTab] = useState<"incoming" | "sent">("incoming");
  const [processingAction, setProcessingAction] = useState<{
    id: string;
    action: "accept" | "reject" | "withdraw";
  } | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // M3b: user external (non-custodial) → aksi offer di-sign di browser.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
  const tx = useTransactionStatus();

  // Eksekusi aksi offer dengan status modal standar (Sign → Broadcast →
  // Success / Failed). Dipanggil dari klik tombol Accept/Reject/Withdraw.
  const runOfferAction = useCallback(
    async (action: "accept" | "reject" | "withdraw", offer: OfferItem) => {
      const token = displayName(offer.instrumentId ?? "Amulet");
      const amountText = `${formatAmount(offer)} ${token}`;
      const labels = {
        accept: { verb: "Accept", title: "Transfer accepted", subtitle: `${token} added to your wallet.` },
        reject: { verb: "Reject", title: "Transfer rejected", subtitle: `Returned to sender.` },
        withdraw: { verb: "Withdraw", title: "Transfer cancelled", subtitle: `${token} returned to your wallet.` },
      } as const;
      const subText =
        action === "withdraw"
          ? `to ${receiverDisplay(offer)}`
          : `from ${senderDisplay(offer)}`;

      setProcessingAction({ id: offer.contractId, action });
      setSuccessMsg(null);
      // Modal status hanya SETELAH sign.
      try {
        // M3b: external → tanda tangan di browser (TransferInstruction).
        if (isExternalWallet) {
          await signRelayTransaction(
            action === "accept"
              ? "accept_offer"
              : action === "reject"
                ? "reject_offer"
                : "withdraw_offer",
            { contractId: offer.contractId },
            {
              onWalletLocked: () =>
                promptPassphrase(`${labels[action].verb} ${amountText}`),
            },
          );
          if (action === "withdraw") {
            removeOfferLocally(setSentOffers, offer.contractId);
          } else {
            removeOfferLocally(setOffers, offer.contractId);
          }
          setSuccessMsg(
            action === "accept"
              ? `Transfer accepted — ${token} added to your wallet.`
              : action === "reject"
                ? `Transfer rejected — ${token} returned to sender.`
                : `Transfer cancelled — ${token} returned to your wallet.`,
          );
          if (action === "withdraw") onSentRefresh?.();
          else onRefresh?.();
          tx.succeed({
            amountText,
            title: labels[action].title,
            subtitle: labels[action].subtitle,
            meta: [
              { label: "Amount", value: amountText },
              {
                label: action === "withdraw" ? "To" : "From",
                value: action === "withdraw" ? receiverDisplay(offer) : senderDisplay(offer),
                mono: true,
              },
              { label: "Network", value: "Canton" },
            ],
          });
          return;
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
              ? { transferInstructionCid: offer.contractId }
              : {
                  contractId: offer.contractId,
                  type: offer.type || "transfer_offer",
                },
          ),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (res.ok && data.ok) {
          if (action === "withdraw") {
            removeOfferLocally(setSentOffers, offer.contractId);
          } else {
            removeOfferLocally(setOffers, offer.contractId);
          }
          setSuccessMsg(
            data.message ??
              (action === "accept"
                ? `Transfer accepted — ${token} added to your wallet.`
                : action === "reject"
                  ? `Transfer rejected — ${token} returned to sender.`
                  : `Transfer cancelled — ${token} returned to your wallet.`),
          );
          if (action === "withdraw") onSentRefresh?.();
          else onRefresh?.();
          tx.succeed({
            amountText,
            title: labels[action].title,
            subtitle: labels[action].subtitle,
            meta: [
              { label: "Amount", value: amountText },
              {
                label: action === "withdraw" ? "To" : "From",
                value: action === "withdraw" ? receiverDisplay(offer) : senderDisplay(offer),
                mono: true,
              },
              { label: "Network", value: "Canton" },
            ],
          });
        } else {
          const msg = data.message ?? `Failed to ${action} transfer.`;
          tx.fail(msg);
        }
      } catch (err) {
        tx.fail(
          err instanceof Error && err.message
            ? err.message
            : "Network error. Check your connection and try again.",
        );
      } finally {
        setProcessingAction(null);
      }
    },
    [setOffers, setSentOffers, onRefresh, onSentRefresh, isExternalWallet, promptPassphrase, tx],
  );

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset success message saat modal ditutup atau ganti tab.
  useEffect(() => {
    if (!open) setSuccessMsg(null);
  }, [open, activeTab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
      role="presentation"
    >
      {/* M3b: prompt passphrase untuk sign aksi offer (user external). */}
      {passphraseModal}

      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transfer offers"
        className="relative z-10 my-auto w-full max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl sm:p-8"
      >
        <div className="flex items-center justify-between gap-2">
          {/* Segmented tab control: Incoming | Sent */}
          <div
            role="tablist"
            aria-label="Offer direction"
            className="flex items-center gap-1 rounded-xl bg-[var(--muted)] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "incoming"}
              onClick={() => setActiveTab("incoming")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === "incoming"
                  ? "bg-canton-subtle text-canton"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Incoming
              {offers.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-canton-soft px-1 text-[10px] font-bold text-canton">
                  {offers.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sent"}
              onClick={() => setActiveTab("sent")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === "sent"
                  ? "bg-canton-subtle text-canton"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Sent
              {sentOffers.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-canton-soft px-1 text-[10px] font-bold text-canton">
                  {sentOffers.length}
                </span>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {/* Success message */}
          {successMsg && (
            <div className="rounded-2xl border border-green-500/20 bg-green-500/5 px-5 py-3 text-sm font-medium text-green-600">
              {successMsg}
            </div>
          )}

          {activeTab === "incoming" ? (
            loading ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner size="sm" />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-600">
                {error}
              </div>
            ) : offers.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-5 py-8 text-center">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">
                  No pending offers
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Incoming transfer requests will appear here.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {offers.map((offer) => {
                  const isAccepting =
                    processingAction?.id === offer.contractId &&
                    processingAction?.action === "accept";
                  const isRejecting =
                    processingAction?.id === offer.contractId &&
                    processingAction?.action === "reject";
                  const isBusy = isAccepting || isRejecting;

                  return (
                    <li
                      key={offer.contractId}
                      className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-2xl px-5 py-4"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-canton-subtle text-canton">
                            <ArrowDownLeft className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                                {formatAmount(offer)}{" "}
                                {displayName(offer.instrumentId ?? "Amulet")}{" "}
                                from {senderDisplay(offer)}
                              </p>
                            </div>
                            {offer.description ? (
                              <p className="truncate text-xs font-medium text-[var(--muted-foreground)]">
                                {offer.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-mono text-[10px] font-medium text-[var(--muted-foreground)] truncate">
                            ID: {offer.contractId.slice(0, 24)}…
                          </p>
                          {offer.expiresAt && (
                            <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                              <Clock className="h-3 w-3" />
                              Expires{" "}
                              {new Date(offer.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runOfferAction("accept", offer)}
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "flex-1 justify-center gap-1.5 text-green-600 hover:text-green-300 border-green-500/20 hover:border-green-500/40",
                          )}
                        >
                          {isAccepting ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runOfferAction("reject", offer)}
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "flex-1 justify-center gap-1.5 text-red-600 hover:text-red-300 border-red-500/20 hover:border-red-500/40",
                          )}
                        >
                          {isRejecting ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                          Reject
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : sentLoading ? (
            <div className="flex items-center justify-center py-6">
              <LoadingSpinner size="sm" />
            </div>
          ) : sentError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-600">
              {sentError}
            </div>
          ) : sentOffers.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-5 py-8 text-center">
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                No outgoing transfers
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Pending transfers you&apos;ve sent can be cancelled here.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {sentOffers.map((offer) => {
                const isWithdrawing =
                  processingAction?.id === offer.contractId &&
                  processingAction?.action === "withdraw";

                return (
                  <li
                    key={offer.contractId}
                    className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-2xl px-5 py-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-canton-subtle text-canton">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                              {formatAmount(offer)}{" "}
                              {displayName(offer.instrumentId ?? "Amulet")} →{" "}
                              {receiverDisplay(offer)}
                            </p>
                          </div>
                          {offer.description ? (
                            <p className="truncate text-xs font-medium text-[var(--muted-foreground)]">
                              {offer.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-[10px] font-medium text-[var(--muted-foreground)] truncate">
                          ID: {offer.contractId.slice(0, 24)}…
                        </p>
                        {offer.expiresAt && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                            <Clock className="h-3 w-3" />
                            Expires{" "}
                            {new Date(offer.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isWithdrawing}
                        onClick={() => void runOfferAction("withdraw", offer)}
                        className={cn(
                          buttonVariants({ variant: "secondary", size: "sm" }),
                          "flex-1 justify-center gap-1.5 text-red-600 hover:text-red-300 border-red-500/20 hover:border-red-500/40",
                        )}
                      >
                        {isWithdrawing ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Undo2 className="h-4 w-4" />
                        )}
                        Withdraw
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
