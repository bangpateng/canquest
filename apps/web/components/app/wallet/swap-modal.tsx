"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import {
  ArrowDown,
  ChevronDown,
  Settings,
  X,
  AlertCircle,
} from "lucide-react";

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

export function SwapModal({ open, onClose, balance }: SwapModalProps) {
  const titleId = useId();

  const [tokens, setTokens] = useState<SwappableToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction>("CC_TO_TOKEN");
  const [selectedToken, setSelectedToken] = useState<SwappableToken | null>(
    null,
  );
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
      .then(
        (d: { enabled?: boolean; phase?: string; message?: string }) => {
          setStatusEnabled(Boolean(d.enabled));
          setStatus(d.message ?? null);
        },
      )
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
        const data = (await res.json()) as QuoteResponse & {
          message?: string;
        };
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
  const inputSymbol =
    direction === "CC_TO_TOKEN"
      ? CC_SYMBOL
      : (selectedToken?.instrumentId ?? "TOKEN");
  const outputSymbol =
    direction === "CC_TO_TOKEN"
      ? (selectedToken?.instrumentId ?? "TOKEN")
      : CC_SYMBOL;

  const insufficientBalance =
    direction === "CC_TO_TOKEN" &&
    typeof balance === "number" &&
    parseFloat(amount) > balance;

  // Percent quick-select (only for CC_TO_TOKEN where we know balance).
  const setPercent = (pct: number) => {
    if (direction === "CC_TO_TOKEN" && typeof balance === "number") {
      setAmount((balance * pct).toFixed(6).replace(/\.?0+$/, ""));
    }
  };

  // Flip direction.
  const flipDirection = () => {
    setDirection((d) => (d === "CC_TO_TOKEN" ? "TOKEN_TO_CC" : "CC_TO_TOKEN"));
    setAmount("");
    setQuote(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/60 backdrop-blur-[3px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#0a0b0d] p-5 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
          >
            Swap
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={iconButtonClass(
                "h-8 w-8 text-slate-400 hover:text-slate-200",
              )}
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className={iconButtonClass(
                "h-8 w-8 text-slate-400 hover:text-slate-200",
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status banner */}
        {!statusEnabled ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs text-amber-300">
            {status ?? "Swap is not available right now."}
          </div>
        ) : null}

        {/* Swap cards */}
        <div className="relative space-y-2">
          {/* ── YOU PAY ── */}
          <SwapCard
            label="You Pay"
            amount={amount}
            onAmountChange={setAmount}
            isInput
            balance={
              direction === "CC_TO_TOKEN"
                ? typeof balance === "number"
                  ? balance.toFixed(4)
                  : undefined
                : undefined
            }
            onPercentClick={direction === "CC_TO_TOKEN" ? setPercent : undefined}
            isLoading={tokensLoading}
            error={tokensError}
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            tokenIsCC={direction === "CC_TO_TOKEN"}
          />

          {/* ── Direction button (circle, overlapping) ── */}
          <div className="relative z-10 flex justify-center">
            <button
              type="button"
              onClick={flipDirection}
              className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#0a0b0d] bg-[#1a1d23] text-amber-400 transition hover:rotate-180 hover:bg-[#252a32]"
              aria-label="Flip swap direction"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>

          {/* ── YOU GET ── */}
          <SwapCard
            label="You Get (est.)"
            amount={quote ? formatAmount(quote.outputAmount) : ""}
            isInput={false}
            isLoading={quoteLoading}
            tokenIsCC={direction === "TOKEN_TO_CC"}
            selectedToken={selectedToken}
            estimated
          />
        </div>

        {/* Insufficient balance */}
        {insufficientBalance && (
          <p className="mt-3 text-center text-sm font-medium text-red-400">
            Insufficient CC balance
          </p>
        )}

        {/* Quote details */}
        {quoteError ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{quoteError}</span>
          </div>
        ) : quote ? (
          <div className="mt-3 space-y-2 rounded-xl border border-white/5 bg-[#13151a] p-4 text-xs">
            <DetailRow
              label="Rate"
              value={`1 ${inputSymbol} ≈ ${formatPrice(quote.prices.tradePrice)} ${outputSymbol}`}
            />
            <DetailRow
              label="Price Impact"
              value={`${formatPct(quote.prices.slippage)}%`}
              valueClass={
                parseFloat(quote.prices.slippage) > 3
                  ? "text-red-400"
                  : "text-emerald-400"
              }
            />
            <DetailRow
              label="Swap Fee"
              value={`${formatAmount(quote.fees.adminFee)} ${quote.outputInstrument.id} (${formatPct(quote.fees.feePercentage)}%)`}
            />
            <DetailRow
              label="Network Fee"
              value={`${formatAmount(quote.fees.networkFee)} ${quote.outputInstrument.id}`}
            />
          </div>
        ) : null}

        {/* CTA button */}
        <button
          type="button"
          disabled
          className={cn(
            buttonVariants({ size: "sm" }),
            "mt-4 w-full cursor-not-allowed opacity-60",
          )}
        >
          Swap Coming Soon
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Quote preview is live. Execution enabled in next phase.
        </p>
      </div>
    </div>
  );
}

// ── Swap Card (input/output token slot) ─────────────────────────────────

interface SwapCardProps {
  label: string;
  amount?: string;
  onAmountChange?: (v: string) => void;
  isInput: boolean;
  balance?: string;
  onPercentClick?: (pct: number) => void;
  isLoading?: boolean;
  error?: string | null;
  tokens?: SwappableToken[];
  selectedToken?: SwappableToken | null;
  onSelectToken?: (t: SwappableToken) => void;
  tokenIsCC: boolean;
  estimated?: boolean;
}

function SwapCard({
  label,
  amount,
  onAmountChange,
  isInput,
  balance,
  onPercentClick,
  isLoading,
  error,
  tokens,
  selectedToken,
  onSelectToken,
  tokenIsCC,
  estimated,
}: SwapCardProps) {
  // Native <select> styled to blend with custom token chip.
  return (
    <div className="rounded-2xl border border-white/5 bg-[#13151a] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {isInput && balance && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Bal: {balance}</span>
            {onPercentClick && (
              <div className="flex gap-1">
                {[0.25, 0.5, 0.75].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPercentClick(p)}
                    className="rounded bg-[#252a32] px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-[#323842] hover:text-white"
                  >
                    {p === 0.25 ? "25" : p === 0.5 ? "50" : "75"}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onPercentClick(1)}
                  className="rounded bg-[#252a32] px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-[#323842]"
                >
                  MAX
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Amount */}
        {isInput ? (
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.000001"
            placeholder="0.0"
            value={amount ?? ""}
            onChange={(e) => onAmountChange?.(e.target.value)}
            className="w-full min-w-0 flex-1 bg-transparent text-2xl font-bold text-white outline-none placeholder:text-slate-600"
          />
        ) : (
          <span
            className={cn(
              "w-full min-w-0 flex-1 text-2xl font-bold",
              estimated ? "text-amber-300" : "text-white",
            )}
          >
            {amount || "0.0"}
          </span>
        )}

        {/* Token selector chip */}
        {tokenIsCC ? (
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-[#252a32] px-3 py-2">
            <TokenAvatar symbol={CC_SYMBOL} />
            <span className="text-sm font-semibold text-white">{CC_SYMBOL}</span>
          </div>
        ) : isLoading ? (
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-[#252a32] px-3 py-2">
            <LoadingSpinner className="h-4 w-4" />
          </div>
        ) : error ? (
          <div className="shrink-0 rounded-full bg-red-500/20 px-3 py-2 text-xs text-red-400">
            Error
          </div>
        ) : tokens && tokens.length > 0 ? (
          <div className="relative shrink-0">
            <select
              value={
                selectedToken
                  ? `${selectedToken.instrumentId}::${selectedToken.instrumentAdmin}`
                  : ""
              }
              onChange={(e) => {
                const found = tokens.find(
                  (t) =>
                    `${t.instrumentId}::${t.instrumentAdmin}` === e.target.value,
                );
                if (found && onSelectToken) onSelectToken(found);
              }}
              className="cursor-pointer appearance-none rounded-full bg-[#252a32] py-2 pl-3 pr-8 text-sm font-semibold text-white outline-none hover:bg-[#323842]"
            >
              {tokens.map((t) => (
                <option
                  key={`${t.instrumentId}::${t.instrumentAdmin}`}
                  value={`${t.instrumentId}::${t.instrumentAdmin}`}
                  className="bg-[#13151a]"
                >
                  {t.instrumentId}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        ) : (
          <div className="shrink-0 rounded-full bg-[#252a32] px-3 py-2 text-xs text-slate-500">
            No tokens
          </div>
        )}
      </div>
    </div>
  );
}

// ── Token Avatar (circle with first letter) ─────────────────────────────

function TokenAvatar({ symbol }: { symbol: string }) {
  const letter = symbol.charAt(0).toUpperCase();
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-[11px] font-bold text-black">
      {letter}
    </span>
  );
}

// ── Detail Row ──────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-slate-400">
      <span>{label}</span>
      <span className={cn("font-medium text-slate-300", valueClass)}>
        {value}
      </span>
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
  return (n < 1 ? n * 100 : n).toFixed(2);
}
