"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { AlertTriangle, CheckCircle2, Clock, Inbox } from "lucide-react";

type PendingOffer = {
  contractId: string;
  senderParty: string;
  senderUsername: string;
  amount: string;
  description: string;
  expiresAtMicros: string;
  createdAt?: string;
  incoming: boolean;
};

interface WalletPendingOffersProps {
  onBalanceRefresh?: () => void;
}

export function WalletPendingOffers({ onBalanceRefresh }: WalletPendingOffersProps) {
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [acceptError, setAcceptError] = useState("");

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/party/transfer-offers", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("Could not load pending offers. Please try again later.");
        setOffers([]);
        return;
      }
      const data = (await res.json()) as { offers?: PendingOffer[] };
      const list = data.offers ?? [];
      // Filter out already-accepted
      setOffers(list.filter((o) => !acceptedIds.has(o.contractId)));
    } catch {
      setError("Network error while fetching offers.");
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [acceptedIds]);

  useEffect(() => {
    void fetchOffers();
  }, [fetchOffers]);

  const handleAccept = useCallback(
    async (contractId: string) => {
      setAcceptingId(contractId);
      setAcceptError("");
      try {
        const res = await fetch("/api/party/accept-offer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId }),
        });
        const data = (await res.json()) as {
          accepted?: boolean;
          message?: string;
        };
        if (res.ok && data.accepted) {
          setAcceptedIds((prev) => new Set(prev).add(contractId));
          setOffers((prev) => prev.filter((o) => o.contractId !== contractId));
          onBalanceRefresh?.();
        } else {
          setAcceptError(
            (data.message as string) ??
              "Failed to accept offer. It may have expired or already been processed.",
          );
        }
      } catch {
        setAcceptError(
          "Network error. Check your connection and try again.",
        );
      } finally {
        setAcceptingId(null);
      }
    },
    [onBalanceRefresh],
  );

  // Check for expired offers (expiresAtMicros is epoch microseconds as string)
  // Compare as numbers: offer expires if nowMs > expiresAtMs (where expiresAtMs = micros / 1000)
  const nowMs = Date.now();
  const activeOffers = offers.filter((o) => {
    const micros = Number(o.expiresAtMicros);
    if (!Number.isFinite(micros) || micros <= 0) return false;
    return nowMs < micros / 1000;
  });
  const expiredCount = offers.length - activeOffers.length;

  if (loading) {
    return (
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
        <div className="flex items-center justify-center py-6">
          <LoadingSpinner size="md" tone="muted" />
        </div>
      </div>
    );
  }

  if (error && offers.length === 0) {
    return (
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-red-500/20 bg-red-500/5 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <p className="text-sm font-medium text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (activeOffers.length === 0 && expiredCount === 0) {
    return null; // Nothing to show
  }

  return (
    <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20">
          <Inbox className="h-5 w-5 shrink-0 text-amber-400" />
        </div>
        <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
          Pending Offers
        </span>
      </div>

      {acceptError ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs font-medium text-red-400">{acceptError}</p>
        </div>
      ) : null}

      {activeOffers.length === 0 && expiredCount > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs font-medium text-amber-300/70">
            {expiredCount} offer{expiredCount > 1 ? "s" : ""} expired. No active offers pending.
          </p>
        </div>
      ) : null}

      {activeOffers.map((offer) => {
        const parsedAmount = parseFloat(offer.amount);
        const displayAmount = Number.isFinite(parsedAmount)
          ? parsedAmount.toFixed(4)
          : offer.amount;
        const isAccepting = acceptingId === offer.contractId;

        return (
          <div
            key={offer.contractId}
            className="mb-4 last:mb-0 rounded-2xl border border-white/5 bg-[var(--muted)]/30 p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-300 truncate">
                  From{" "}
                  <span className="font-semibold text-slate-100">
                    {offer.senderUsername || offer.senderParty.slice(0, 20) + "\u2026"}
                  </span>
                </p>
                {offer.description ? (
                  <p className="mt-1 text-xs text-slate-400 truncate">
                    {offer.description}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-lg font-extrabold tabular-nums text-canton">
                {displayAmount} CC
              </p>
            </div>
            <button
              type="button"
              disabled={isAccepting}
              onClick={() => handleAccept(offer.contractId)}
              className={cn(
                buttonVariants({ size: "sm" }),
                "w-full justify-center gap-2",
              )}
            >
              {isAccepting ? (
                <>
                  <LoadingSpinner size="sm" />
                  Accepting\u2026
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Accept
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}