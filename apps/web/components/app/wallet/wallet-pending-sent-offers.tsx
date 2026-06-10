"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { AlertTriangle, Clock, Send, XCircle } from "lucide-react";

type SentOffer = {
  id: string;
  contractId: string;
  recipientParty: string;
  recipientLabel: string;
  amountCc: number;
  description: string;
  status: string;
  createdAt: string;
};

interface WalletPendingSentOffersProps {
  onBalanceRefresh?: () => void;
}

export function WalletPendingSentOffers({ onBalanceRefresh }: WalletPendingSentOffersProps) {
  const [offers, setOffers] = useState<SentOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/party/sent-offers", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("Could not load sent offers.");
        setOffers([]);
        return;
      }
      const data = (await res.json()) as { offers?: SentOffer[] };
      setOffers(data.offers ?? []);
    } catch {
      setError("Network error.");
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOffers();
  }, [fetchOffers]);

  const handleCancel = useCallback(
    async (offerId: string) => {
      setCancellingId(offerId);
      try {
        const res = await fetch("/api/party/cancel-offer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId }),
        });
        if (res.ok) {
          setOffers((prev) => prev.filter((o) => o.id !== offerId));
          onBalanceRefresh?.();
        }
      } catch {
        // ignore
      } finally {
        setCancellingId(null);
      }
    },
    [onBalanceRefresh],
  );

  const pendingOffers = offers.filter((o) => o.status === "pending");

  if (loading) {
    return (
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
        <div className="flex items-center justify-center py-4">
          <LoadingSpinner size="md" tone="muted" />
        </div>
      </div>
    );
  }

  if (error && pendingOffers.length === 0) {
    return null;
  }

  if (pendingOffers.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/20">
          <Send className="h-5 w-5 shrink-0 text-cyan-400" />
        </div>
        <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
          Pending Sent Offers
        </span>
      </div>

      {pendingOffers.map((offer) => {
        const isCancelling = cancellingId === offer.id;

        return (
          <div
            key={offer.id}
            className="mb-3 last:mb-0 rounded-2xl border border-white/5 bg-[var(--muted)]/30 p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-300 truncate">
                  To{" "}
                  <span className="font-semibold text-slate-100">
                    {offer.recipientLabel}
                  </span>
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-400">
                  <Clock className="h-3 w-3 shrink-0" />
                  Waiting for acceptance
                </p>
              </div>
              <p className="shrink-0 text-lg font-extrabold tabular-nums text-canton">
                {offer.amountCc.toFixed(4)} CC
              </p>
            </div>
            <button
              type="button"
              disabled={isCancelling}
              onClick={() => handleCancel(offer.id)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "w-full justify-center gap-2",
              )}
            >
              {isCancelling ? (
                <>
                  <LoadingSpinner size="sm" />
                  Cancelling…
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 shrink-0" />
                  Cancel Offer
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}