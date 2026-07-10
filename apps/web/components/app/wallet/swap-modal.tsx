"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { ArrowLeftRight, ArrowDown, X, AlertCircle } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

interface SwappableToken {
  instrumentId: string;
  instrumentAdmin: string;
}

interface PoolsResponse {
  ccInstrument: { id: string; admin: string };
  tokens: SwappableToken[];
}

interface QuoteResponse {
  direction: string;
  sellAmount: string;
  sellInstrument: { id: string; admin: string };
  buyInstrument: { id: string; admin: string };
  outputAmount: string;
  outputInstrument: { id: string; admin: string };
  fees: {
    feePercentage: string;
    adminFee: string;
    liquidityFee: string;
    networkFee: string;
  };
  prices: {
    slippage: string;
    tradePrice: string;
  };
  estimatedTimeSeconds: number;
}

interface SwapModalProps {
  open: boolean;
  onClose: () => void;
  balance?: number | null;
  onBalanceRefresh?: () => void;
}

type Direction = "CC_TO_TOKEN" | "TOKEN_TO_CC";

const CC_SYMBOL = "CC";

// ── Component ───────────────────────────────────────────────────────────

export function SwapModal({
  open,
  onClose,
  balance,
}: SwapModalProps) {
  const titleId = useId();

  const [tokens, setTokens] = useState<SwappableToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction>("CC_TO_TOKEN");
  const [selectedToken, setSelectedToken] = useState<SwappableToken | null>(null);
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [statusEnabled, setStatusEnabled] = useState(true);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Check swap status (enabled/phase) on open.
  useEffect(() => {
    if (!open) return;
    fetch("/api/party/swap/status", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { enabled?: boolean; phase?: string; message?: string }) => {
        setStatusEnabled(Boolean(d.enabled));
        setStatus(d.message ?? null);
      })
      .catch(() => setStatus(null));
  }, [open]);

  // Fetch swappable tokens when modal opens.
  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const res = await fetch("/api/party/swap/pools", {
        credentials: "include",
      });
      const data = (await res.json()) as PoolsResponse & { message?: string };
      if (!res.ok) {
        setTokensError(data.message ?? "Could not load swap tokens.");
        return;
      }
      setTokens(data.tokens ?? []);
      if (data.tokens.length > 0 && !selectedToken) {
        setSelectedToken(data.tokens[0]!);
      }
    } catch {
      setTokensError("Network error. Check your connection.");
    } finally {
      setTokensLoading(false);
    }
  }, [selectedToken]);

  useEffect(() => {
    if (open && statusEnabled) void loadTokens();
  }, [open, statusEnabled, loadTokens]);

  // Debounced live quote.
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!selectedToken || !amt || amt <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/party/swap/quote", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            direction,
            instrumentId: selectedToken.instrumentId,
            instrumentAdmin: selectedToken.instrumentAdmin,
            amount: amt,
          }),
        });
        const data = (await res.json()) as QuoteResponse & { message?: string };
        if (!res.ok) {
          setQuoteError(data.message ?? "Could not get quote.");
          setQuote(null);
          return;
        }
        setQuote(data);
      } catch {
        setQuoteError("Network error fetching quote.");
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [amount, selectedToken, direction]);

  if (!open) return null;

  // Input symbol: CC_TO_TOKEN → user enters CC; TOKEN_TO_CC → user enters token.
  const inputSymbol = direction === "CC_TO_TOKEN" ? CC_SYMBOL : selectedToken?.instrumentId ?? "TOKEN";
  const outputSymbol = direction === "CC_TO_TOKEN" ? (selectedToken?.instrumentId ?? "TOKEN") : CC_SYMBOL;

  const insufficientBalance =
    direction === "CC_TO_TOKEN" &&
    typeof balance === "number" &&
    parseFloat(amount) > balance;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-8 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-emerald-400" aria-hidden />
            <h2 id={titleId} className="text-xl font-bold text-slate-100">
              Swap
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-9 w-9 shrink-0 text-[var(--foreground)]")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status banner */}
        {!statusEnabled ? (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            Swap is not available right now. {status}
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* Direction toggle */}
            <div className="flex items-center gap-2 rounded-xl bg-black/20 p-1">
              <button
                type="button"
                onClick={() => setDirection("CC_TO_TOKEN")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition",
                  direction === "CC_TO_TOKEN"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                CC → Token
              </button>
              <button
                type="button"
                onClick={() => setDirection("TOKEN_TO_CC")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition",
                  direction === "TOKEN_TO_CC"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                Token → CC
              </button>
            </div>

            {/* Token selector */}
            {tokensLoading ? (
              <div className="flex items-center justify-center py-4">
                <LoadingSpinner />
              </div>
            ) : tokensError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{tokensError}</span>
              </div>
            ) : tokens.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No tokens available for swap yet.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">
                    Token
                  </label>
                  <select
                    value={
                      selectedToken
                        ? `${selectedToken.instrumentId}::${selectedToken.instrumentAdmin}`
                        : ""
                    }
                    onChange={(e) => {
                      const found = tokens.find(
                        (t) =>
                          `${t.instrumentId}::${t.instrumentAdmin}` ===
                          e.target.value,
                      );
                      setSelectedToken(found ?? null);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
                  >
                    {tokens.map((t) => (
                      <option
                        key={`${t.instrumentId}::${t.instrumentAdmin}`}
                        value={`${t.instrumentId}::${t.instrumentAdmin}`}
                        className="bg-[var(--card)]"
                      >
                        {t.instrumentId}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">
                    You pay ({inputSymbol})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.000001"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-lg font-semibold text-slate-100 outline-none focus:border-emerald-500/50"
                  />
                  {direction === "CC_TO_TOKEN" && typeof balance === "number" && (
                    <p className="text-xs text-slate-500">
                      Balance: {balance.toFixed(4)} CC
                    </p>
                  )}
                </div>

                {/* Direction indicator */}
                <div className="flex justify-center">
                  <div className="rounded-full border border-white/10 bg-black/30 p-2">
                    <ArrowDown className="h-4 w-4 text-slate-400" aria-hidden />
                  </div>
                </div>

                {/* Output estimate */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">
                    You receive (est. {outputSymbol})
                  </label>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-lg font-semibold text-emerald-300">
                    {quoteLoading
                      ? "…"
                      : quote
                        ? formatAmount(quote.outputAmount)
                        : "0.0"}
                  </div>
                </div>

                {/* Quote details */}
                {quoteError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{quoteError}</span>
                  </div>
                ) : quote ? (
                  <div className="space-y-1.5 rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-400">
                    <Row label="Price" value={`1 ${inputSymbol} ≈ ${formatPrice(quote.prices.tradePrice)} ${outputSymbol}`} />
                    <Row label="Price impact" value={`${formatPct(quote.prices.slippage)}%`} />
                    <Row label="Fee" value={`${formatAmount(quote.fees.adminFee)} ${quote.outputInstrument.id} + ${formatAmount(quote.fees.liquidityFee)}`} />
                    <Row label="Network fee" value={`${formatAmount(quote.fees.networkFee)} ${quote.outputInstrument.id}`} />
                  </div>
                ) : null}

                {insufficientBalance && (
                  <p className="text-xs text-red-400">
                    Insufficient CC balance.
                  </p>
                )}

                {/* Phase 1: execution disabled */}
                <button
                  type="button"
                  disabled
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "w-full cursor-not-allowed opacity-60",
                  )}
                >
                  Swap Coming Soon
                </button>
                <p className="text-center text-[11px] text-slate-500">
                  Quote preview is live. Swap execution will be enabled in the next phase.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatAmount(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(6);
}

function formatPrice(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function formatPct(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return "0";
  // slippage bisa sudah dalam persen atau fraction — tampilkan sapa 2 desimal.
  return (n < 1 ? n * 100 : n).toFixed(2);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-medium text-slate-300">{value}</span>
    </div>
  );
}
