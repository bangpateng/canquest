"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ArrowDownLeft, Check, X } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export interface OfferItem {
  contractId: string;
  sender: string;
  receiver: string;
  amountCc: number;
  description: string;
  trackingId: string;
}

interface OffersSectionProps {
  onRefresh?: () => void;
}

export function OffersSection({ onRefresh }: OffersSectionProps) {
  const t = usePlatformT();
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/party/offers", { credentials: "include" });
      const data = (await res.json()) as { offers?: OfferItem[]; count?: number; message?: string };
      if (!res.ok) {
        setOffers([]);
        setError(data.message ?? `Server error (HTTP ${res.status}).`);
        return;
      }
      setOffers(data.offers ?? []);
      if (data.message && data.message !== "No wallet found.") {
        // Show server message only if it's not a normal "no wallet" state
      }
    } catch {
      setOffers([]);
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOffers();
  }, [fetchOffers]);

  const handleAccept = useCallback(
    async (contractId: string) => {
      setProcessingIds((prev) => new Set(prev).add(contractId));
      try {
        const res = await fetch("/api/party/accept-offer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId }),
        });
        const data = (await res.json()) as { accepted?: boolean; message?: string };
        if (res.ok && data.accepted) {
          // Remove from list
          setOffers((prev) => prev.filter((o) => o.contractId !== contractId));
          onRefresh?.();
        } else {
          alert(data.message ?? "Failed to accept offer.");
        }
      } catch {
        alert("Network error. Check your connection and try again.");
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(contractId);
          return next;
        });
      }
    },
    [onRefresh],
  );

  const handleReject = useCallback(
    async (contractId: string) => {
      setProcessingIds((prev) => new Set(prev).add(contractId));
      try {
        const res = await fetch("/api/party/reject-offer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId }),
        });
        const data = (await res.json()) as { rejected?: boolean; message?: string };
        if (res.ok && data.rejected) {
          setOffers((prev) => prev.filter((o) => o.contractId !== contractId));
          onRefresh?.();
        } else {
          alert(data.message ?? "Failed to reject offer.");
        }
      } catch {
        alert("Network error. Check your connection and try again.");
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(contractId);
          return next;
        });
      }
    },
    [onRefresh],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingSpinner size="sm" tone="muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-400">
        {error}
      </div>
    );
  }

  if (offers.length === 0) {
    return null; // Nothing to show
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Pending Offers ({offers.length})
      </p>
      <ul className="space-y-3">
        {offers.map((offer) => {
          const isProcessing = processingIds.has(offer.contractId);
          const senderLabel = offer.sender.includes("::")
            ? offer.sender.split("::")[0]
            : offer.sender;

          return (
            <li
              key={offer.contractId}
              className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
                    <ArrowDownLeft className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {offer.amountCc.toFixed(4)} CC from {senderLabel}
                    </p>
                    {offer.description ? (
                      <p className="truncate text-xs font-medium text-slate-400">
                        {offer.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="font-mono text-[10px] font-medium text-slate-500 truncate">
                  ID: {offer.contractId.slice(0, 24)}…
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleAccept(offer.contractId)}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "gap-1.5 text-green-400 hover:text-green-300 border-green-500/20 hover:border-green-500/40",
                  )}
                >
                  {isProcessing ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Accept
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleReject(offer.contractId)}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "gap-1.5 text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40",
                  )}
                >
                  {isProcessing ? (
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
    </div>
  );
}