"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { ArrowDownLeft, Check, X, Clock } from "lucide-react";

export interface OfferItem {
  type: "transfer_offer" | "transfer_instruction";
  contractId: string;
  sender: string;
  senderLabel?: string;
  receiver: string;
  amount: string;
  description: string;
  expiresAt?: string;
  createdAt?: string;
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
 * Hook: fetch & re-fetch pending incoming offers.
 * Dipakai oleh badge tombol "Offers" (count) dan modal Offers.
 *
 * refresh() mengembalikan jumlah offer setelah fetch — berguna untuk
 * pemilik tombol (wallet-actions) agar tahu apakah perlu menampilkan badge.
 */
export function useOffers() {
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/party/offers", { credentials: "include" });
      const data = (await res.json()) as OffersResponse;
      if (!res.ok) {
        setOffers([]);
        setError(data.message ?? `Server error (HTTP ${res.status}).`);
        return 0;
      }
      const list = data.offers ?? [];
      setOffers(list);
      setError(null);
      return list.length;
    } catch {
      setOffers([]);
      setError("Network error. Check your connection.");
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Poll ringan tiap 30s supaya badge selalu up-to-date tanpa reload.
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { offers, loading, error, refresh, setOffers };
}

/**
 * Remove satu offer dari list lokal (setelah accept/reject sukses).
 */
export function removeOfferLocally(
  setOffers: React.Dispatch<React.SetStateAction<OfferItem[]>>,
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
  setOffers: React.Dispatch<React.SetStateAction<OfferItem[]>>;
  onRefresh?: () => void;
}

export function OffersModal({
  open,
  onClose,
  offers,
  loading,
  error,
  setOffers,
  onRefresh,
}: OffersModalProps) {
  const [processingAction, setProcessingAction] = useState<{
    id: string;
    action: "accept" | "reject";
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
            data.message ?? "Transfer accepted — CC added to your wallet.",
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
          setSuccessMsg("Transfer rejected — CC returned to sender.");
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

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset success message saat modal ditutup.
  useEffect(() => {
    if (!open) setSuccessMsg(null);
  }, [open]);

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
        aria-label="Incoming offers"
        className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-6 sm:p-8 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-emerald-400" aria-hidden />
            <h2 className="text-xl font-bold text-slate-100">
              Offers
              {offers.length > 0 && (
                <span className="ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500/15 px-2 text-xs font-bold text-emerald-400">
                  {offers.length}
                </span>
              )}
            </h2>
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

          {loading ? (
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
                Incoming CC transfer requests will appear here.
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
                              {formatAmount(offer)} CC from{" "}
                              {senderDisplay(offer)}
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
          )}
        </div>
      </div>
    </div>
  );
}
