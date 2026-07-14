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
  cip56Count?: number;
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
 * Di-back TanStack Query: poll 30s via refetchInterval (silent, no flicker),
 * refetch saat tab focus/reconnect, cache global di-dedup.
 *
 * refresh() mengembalikan jumlah offer setelah fetch — berguna untuk
 * pemilik tombol (wallet-actions) agar tahu apakah perlu menampilkan badge.
 * setOffers tetap disediakan untuk optimistic remove lokal (accept/reject).
 */
export function useOffers() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.party.offers,
    queryFn: async (): Promise<{ items: OfferItem[]; error: string | null }> => {
      try {
        const res = await fetch("/api/party/offers", { credentials: "include" });
        const data = (await res.json()) as OffersResponse;
        if (!res.ok) {
          return { items: [], error: data.message ?? `Server error (HTTP ${res.status}).` };
        }
        return { items: data.offers ?? [], error: null };
      } catch {
        return { items: [], error: "Network error. Check your connection." };
      }
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  const data = query.data;
  const offers = data?.items ?? [];
  const error = data?.error ?? null;

  /** Optimistic remove lokal (accept/reject) — update cache react-query. */
  const setOffers = useCallback(
    (updater: (prev: OfferItem[]) => OfferItem[]) => {
      queryClient.setQueryData<{ items: OfferItem[]; error: string | null } | undefined>(
        queryKeys.party.offers,
        (prev) => {
          const items = prev?.items ?? [];
          return { items: updater(items), error: null };
        },
      );
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.party.offers });
    const latest = queryClient.getQueryData<{ items: OfferItem[] } | undefined>(
      queryKeys.party.offers,
    );
    return latest?.items.length ?? 0;
  }, [queryClient]);

  return { offers, loading: query.isPending, error, refresh, setOffers };
}

/**
 * Hook: fetch & re-fetch OUTGOING (sent) pending offers — dipakai tab Sent
 * di modal Offers (tombol Withdraw). Mirror useOffers tapi query key terpisah
 * (queryKeys.party.sentOffers) + fetch ?direction=outgoing.
 */
export function useSentOffers() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.party.sentOffers,
    queryFn: async (): Promise<{ items: OfferItem[]; error: string | null }> => {
      try {
        const res = await fetch("/api/party/offers?direction=outgoing", {
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
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  const data = query.data;
  const sentOffers = data?.items ?? [];
  const sentError = data?.error ?? null;

  const setSentOffers = useCallback(
    (updater: (prev: OfferItem[]) => OfferItem[]) => {
      queryClient.setQueryData<{ items: OfferItem[]; error: string | null } | undefined>(
        queryKeys.party.sentOffers,
        (prev) => {
          const items = prev?.items ?? [];
          return { items: updater(items), error: null };
        },
      );
    },
    [queryClient],
  );

  const refreshSentOffers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.party.sentOffers });
    const latest = queryClient.getQueryData<{ items: OfferItem[] } | undefined>(
      queryKeys.party.sentOffers,
    );
    return latest?.items.length ?? 0;
  }, [queryClient]);

  return {
    sentOffers,
    loading: query.isPending,
    error: sentError,
    refresh: refreshSentOffers,
    setOffers: setSentOffers,
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

  const handleAccept = useCallback(
    async (offer: OfferItem) => {
      setProcessingAction({ id: offer.contractId, action: "accept" });
      setSuccessMsg(null);
      try {
        const res = await fetch("/api/party/offers/accept", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId: offer.contractId,
            type: offer.type || "transfer_offer",
          }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (res.ok && data.ok) {
          removeOfferLocally(setOffers, offer.contractId);
          setSuccessMsg(
            data.message ??
              `Transfer accepted — ${displayName(offer.instrumentId ?? "Amulet")} added to your wallet.`,
          );
          onRefresh?.();
        } else {
          alert(data.message ?? "Failed to accept offer.");
        }
      } catch {
        alert("Network error. Check your connection and try again.");
      } finally {
        setProcessingAction(null);
      }
    },
    [setOffers, onRefresh],
  );

  const handleReject = useCallback(
    async (offer: OfferItem) => {
      setProcessingAction({ id: offer.contractId, action: "reject" });
      setSuccessMsg(null);
      try {
        const res = await fetch("/api/party/offers/reject", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId: offer.contractId,
            type: offer.type || "transfer_offer",
          }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (res.ok && data.ok) {
          removeOfferLocally(setOffers, offer.contractId);
          setSuccessMsg(
            `Transfer rejected — ${displayName(offer.instrumentId ?? "Amulet")} returned to sender.`,
          );
          onRefresh?.();
        } else {
          alert(data.message ?? "Failed to reject offer.");
        }
      } catch {
        alert("Network error. Check your connection and try again.");
      } finally {
        setProcessingAction(null);
      }
    },
    [setOffers, onRefresh],
  );

  // Withdraw (cancel) outgoing offer — hanya sender yang boleh. Mirror
  // handleReject tapi kirim ke /transfer-instruction/withdraw + optimistic
  // remove di list Sent (setSentOffers), bukan list Incoming.
  const handleWithdraw = useCallback(
    async (offer: OfferItem) => {
      setProcessingAction({ id: offer.contractId, action: "withdraw" });
      setSuccessMsg(null);
      try {
        const res = await fetch("/api/party/transfer-instruction/withdraw", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferInstructionCid: offer.contractId,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (res.ok && data.ok) {
          removeOfferLocally(setSentOffers, offer.contractId);
          setSuccessMsg(
            data.message ??
              `Transfer cancelled — ${displayName(offer.instrumentId ?? "Amulet")} returned to your wallet.`,
          );
          onSentRefresh?.();
        } else {
          alert(data.message ?? "Failed to withdraw transfer.");
        }
      } catch {
        alert("Network error. Check your connection and try again.");
      } finally {
        setProcessingAction(null);
      }
    },
    [setSentOffers, onSentRefresh],
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
      <button
        type="button"
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transfer offers"
        className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-6 sm:p-8 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          {/* Segmented tab control: Incoming | Sent */}
          <div
            role="tablist"
            aria-label="Offer direction"
            className="flex items-center gap-1 rounded-xl bg-white/[0.03] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "incoming"}
              onClick={() => setActiveTab("incoming")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === "incoming"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Incoming
              {offers.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-400">
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
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Sent
              {sentOffers.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-400">
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
            <div className="rounded-2xl border border-green-500/20 bg-green-500/5 px-5 py-3 text-sm font-medium text-green-400">
              {successMsg}
            </div>
          )}

          {activeTab === "incoming" ? (
            loading ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner size="sm" tone="muted" />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-400">
                {error}
              </div>
            ) : offers.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-8 text-center">
                <p className="text-sm font-medium text-slate-400">
                  No pending offers
                </p>
                <p className="mt-1 text-xs text-slate-500">
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
                      className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl px-5 py-4"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
                            <ArrowDownLeft className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">
                                {formatAmount(offer)}{" "}
                                {displayName(offer.instrumentId ?? "Amulet")}{" "}
                                from {senderDisplay(offer)}
                              </p>
                              <span
                                className={cn(
                                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                  offer.type === "transfer_instruction"
                                    ? "bg-blue-500/15 text-blue-400"
                                    : "bg-slate-500/15 text-slate-500",
                                )}
                              >
                                {offer.type === "transfer_instruction"
                                  ? "CIP-56"
                                  : "Legacy"}
                              </span>
                            </div>
                            {offer.description ? (
                              <p className="truncate text-xs font-medium text-slate-400">
                                {offer.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-mono text-[10px] font-medium text-slate-500 truncate">
                            ID: {offer.contractId.slice(0, 24)}…
                          </p>
                          {offer.expiresAt && (
                            <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-600">
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
                          onClick={() => handleAccept(offer)}
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "flex-1 justify-center gap-1.5 text-green-400 hover:text-green-300 border-green-500/20 hover:border-green-500/40",
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
                          onClick={() => handleReject(offer)}
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "flex-1 justify-center gap-1.5 text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40",
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
              <LoadingSpinner size="sm" tone="muted" />
            </div>
          ) : sentError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-400">
              {sentError}
            </div>
          ) : sentOffers.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-8 text-center">
              <p className="text-sm font-medium text-slate-400">
                No outgoing transfers
              </p>
              <p className="mt-1 text-xs text-slate-500">
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
                    className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl px-5 py-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-white">
                              {formatAmount(offer)}{" "}
                              {displayName(offer.instrumentId ?? "Amulet")} →{" "}
                              {receiverDisplay(offer)}
                            </p>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                offer.type === "transfer_instruction"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-slate-500/15 text-slate-500",
                              )}
                            >
                              {offer.type === "transfer_instruction"
                                ? "CIP-56"
                                : "Legacy"}
                            </span>
                          </div>
                          {offer.description ? (
                            <p className="truncate text-xs font-medium text-slate-400">
                              {offer.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-[10px] font-medium text-slate-500 truncate">
                          ID: {offer.contractId.slice(0, 24)}…
                        </p>
                        {offer.expiresAt && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-600">
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
                        onClick={() => handleWithdraw(offer)}
                        className={cn(
                          buttonVariants({ variant: "secondary", size: "sm" }),
                          "flex-1 justify-center gap-1.5 text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40",
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
