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
  Search,
} from "lucide-react";

/** Token aktif untuk swap (selain CC). Lainnya = Coming Soon. */
const ACTIVE_SWAP_TOKENS = new Set(["USDCX"]);
function isSwapActive(symbol: string, isCC?: boolean): boolean {
  if (isCC) return true;
  return ACTIVE_SWAP_TOKENS.has(symbol.toUpperCase());
}

// ── Types ───────────────────────────────────────────────────────────────

interface SwapToken {
  instrumentId: string;
  instrumentAdmin: string;
  isCC?: boolean;
}

interface PoolsResponse {
  tokens: SwapToken[];
}

interface QuoteResponse {
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
    feeInstrument?: { id: string; admin: string };
    networkFeeInstrument?: { id: string; admin: string };
  };
  prices: {
    slippage: string;
    tradePrice: string;
  };
  estimatedTimeSeconds: number;
}

/** Minimum swap amount (Cantex DEX requirement: minimum ticket size 10 CC). */
const MIN_SWAP_AMOUNT = 10;

interface SwapModalProps {
  open: boolean;
  onClose: () => void;
  balance?: number | null;
  onBalanceRefresh?: () => void;
}

import {
  TokenLogo,
  displayName,
} from "@/components/app/wallet/token-logo";

// ── Component ───────────────────────────────────────────────────────────

export function SwapModal({ open, onClose, balance }: SwapModalProps) {
  const titleId = useId();

  const [tokens, setTokens] = useState<SwapToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  // Saldo per-token (CC + non-CC). Key = "<id>::<admin>", value = decimal string.
  const [balances, setBalances] = useState<{
    cc: number;
    tokens: Record<string, string>;
  }>({ cc: 0, tokens: {} });

  // Two independent slots — user can pick any token in either.
  const [sellToken, setSellToken] = useState<SwapToken | null>(null);
  const [buyToken, setBuyToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [statusEnabled, setStatusEnabled] = useState(true);

  // Swap execution state.
  const [swapState, setSwapState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [swapMessage, setSwapMessage] = useState("");
  const [swapOutput, setSwapOutput] = useState("");
  const [swapReceivedToken, setSwapReceivedToken] = useState("");

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Check swap status on open.
  useEffect(() => {
    if (!open) return;
    fetch("/api/party/swap/status", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: { enabled?: boolean; message?: string }) => {
          setStatusEnabled(Boolean(d.enabled));
          setStatus(d.message ?? null);
        },
      )
      .catch(() => setStatus(null));
  }, [open]);

  // Fetch all tokens when modal opens.
  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const [poolsRes, balRes] = await Promise.all([
        fetch("/api/party/swap/pools", { credentials: "include" }),
        fetch("/api/party/swap/balances", { credentials: "include" }),
      ]);
      const data = (await poolsRes.json()) as PoolsResponse & {
        message?: string;
      };
      if (!poolsRes.ok) {
        setTokensError(data.message ?? "Could not load tokens.");
        return;
      }
      const list = data.tokens ?? [];
      setTokens(list);
      // Default: sell = CC (Amulet), buy = first non-CC token.
      const cc = list.find((t) => t.isCC);
      const firstNonCC = list.find((t) => !t.isCC);
      setSellToken(cc ?? list[0] ?? null);
      setBuyToken(firstNonCC ?? (list[1] ?? null));
      // Load balances (CC + non-CC) — non-blocking, jangan gagal kalau error.
      if (balRes.ok) {
        const bal = (await balRes.json()) as {
          cc: number;
          tokens: Record<string, string>;
        };
        setBalances(bal);
      }
    } catch {
      setTokensError("Network error. Check your connection.");
    } finally {
      setTokensLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && statusEnabled) void loadTokens();
  }, [open, statusEnabled, loadTokens]);

  // Debounced live quote.
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!sellToken || !buyToken || !amt || amt <= 0 || sellToken.instrumentId === buyToken.instrumentId) {
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
            sellInstrumentId: sellToken.instrumentId,
            sellInstrumentAdmin: sellToken.instrumentAdmin,
            buyInstrumentId: buyToken.instrumentId,
            buyInstrumentAdmin: buyToken.instrumentAdmin,
            amount: amt,
            sellIsCC: sellToken.isCC,
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
  }, [amount, sellToken, buyToken]);

  if (!open) return null;

  const sellIsCC = Boolean(sellToken?.isCC);
  // Saldo token yang dijual (CC dari prop, non-CC dari balances.tokens).
  const sellBalance = sellToken
    ? sellIsCC
      ? typeof balance === "number"
        ? balance
        : balances.cc
      : parseFloat(
          balances.tokens[
            `${sellToken.instrumentId}::${sellToken.instrumentAdmin}`
          ] ?? "0",
        )
    : 0;
  const insufficientBalance =
    sellBalance > 0 && parseFloat(amount) > sellBalance;
  const sameToken =
    sellToken && buyToken && sellToken.instrumentId === buyToken.instrumentId;
  // Minimum 10 hanya saat JUAL CC (Cantex ticket size). Token→CC bebas.
  const belowMinimum =
    sellToken?.isCC &&
    parseFloat(amount) > 0 &&
    parseFloat(amount) < MIN_SWAP_AMOUNT;

  // Percent quick-select — works for ANY token (CC + non-CC).
  const setPercent = (pct: number) => {
    if (sellBalance > 0) {
      setAmount((sellBalance * pct).toFixed(6).replace(/\.?0+$/, ""));
    }
  };

  // Flip sell <-> buy.
  const flipTokens = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setAmount("");
    setQuote(null);
  };

  // Execute swap via POST /api/party/swap.
  const submitSwap = async () => {
    if (!sellToken || !buyToken || !amount || sameToken || insufficientBalance)
      return;
    setSwapState("loading");
    setSwapMessage("");
    setSwapOutput("");
    try {
      const res = await fetch("/api/party/swap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellInstrumentId: sellToken.instrumentId,
          sellInstrumentAdmin: sellToken.instrumentAdmin,
          buyInstrumentId: buyToken.instrumentId,
          buyInstrumentAdmin: buyToken.instrumentAdmin,
          amount: parseFloat(amount),
          sellIsCC: sellToken.isCC,
          clientNonce:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        outputAmount?: string;
        message?: string;
      };
      if (!res.ok || !data.success) {
        setSwapState("error");
        setSwapMessage(
          data.message ?? "Swap failed. Please try again.",
        );
        return;
      }
      setSwapState("success");
      setSwapOutput(data.outputAmount ?? "");
      setSwapReceivedToken(buyToken?.instrumentId ?? "");
      // Refresh balances.
      void loadTokens();
    } catch {
      setSwapState("error");
      setSwapMessage("Network error. Check your connection.");
    }
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
          <h2 id={titleId} className="text-lg font-bold text-white">
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

        {/* Loading state */}
        {tokensLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner className="h-6 w-6" />
          </div>
        ) : tokensError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{tokensError}</span>
          </div>
        ) : tokens.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            No tokens available for swap yet.
          </p>
        ) : (
          <>
            {/* Swap cards */}
            <div className="relative space-y-2">
              {/* ── SLOT ATAS (sell) ── */}
              <SwapCard
                label="You Pay"
                amount={amount}
                onAmountChange={setAmount}
                isInput
                balance={
                  sellBalance > 0 ? sellBalance.toFixed(4) : undefined
                }
                onPercentClick={
                  sellBalance > 0 ? setPercent : undefined
                }
                tokens={tokens}
                selectedToken={sellToken}
                onSelectToken={setSellToken}
                excludeToken={buyToken}
              />

              {/* ── Flip button ── */}
              <div className="relative z-10 flex justify-center">
                <button
                  type="button"
                  onClick={flipTokens}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#0a0b0d] bg-[#1a1d23] text-amber-400 transition hover:rotate-180 hover:bg-[#252a32]"
                  aria-label="Flip tokens"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              {/* ── SLOT BAWAH (buy) ── */}
              <SwapCard
                label="You Get (est.)"
                amount={quote ? formatAmount(quote.outputAmount) : ""}
                isInput={false}
                isLoading={quoteLoading}
                tokens={tokens}
                selectedToken={buyToken}
                onSelectToken={setBuyToken}
                excludeToken={sellToken}
                estimated
              />
            </div>

            {/* Same token warning */}
            {sameToken && (
              <p className="mt-3 text-center text-sm text-amber-400">
                Select different tokens to swap.
              </p>
            )}

            {/* Insufficient balance */}
            {insufficientBalance && (
              <p className="mt-3 text-center text-sm font-medium text-red-400">
                Insufficient {displayName(sellToken?.instrumentId ?? "")} balance
              </p>
            )}

            {/* Quote details */}
            {!sameToken &&
              (quoteError ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{quoteError}</span>
                </div>
              ) : quote ? (
                <div className="mt-3 space-y-2 rounded-xl border border-white/5 bg-[#13151a] p-4 text-xs">
                  <DetailRow
                    label="Rate"
                    value={`1 ${displayName(sellToken?.instrumentId ?? "")} ≈ ${formatPrice(quote.prices.tradePrice)} ${displayName(buyToken?.instrumentId ?? "")}`}
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
                    value={`${formatAmount(quote.fees.adminFee)} ${displayName(quote.fees.feeInstrument?.id ?? quote.outputInstrument.id)} (${formatPct(quote.fees.feePercentage)}%)`}
                  />
                  <DetailRow
                    label="Network Fee"
                    value={`${formatAmount(quote.fees.networkFee)} ${displayName(quote.fees.networkFeeInstrument?.id ?? quote.outputInstrument.id)}`}
                  />
                </div>
              ) : null)}

            {/* CTA / Swap execution */}
            {swapState === "success" ? (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-400">
                  Swap completed!
                </p>
                {swapOutput && (
                  <p className="mt-1 text-xs text-slate-400">
                    Received {swapOutput}{" "}
                    {displayName(swapReceivedToken || (buyToken?.instrumentId ?? ""))}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSwapState("idle");
                    setAmount("");
                  }}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "mt-3 w-full",
                  )}
                >
                  Done
                </button>
              </div>
            ) : swapState === "error" ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{swapMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSwapState("idle")}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "w-full",
                  )}
                >
                  Try Again
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={submitSwap}
                disabled={
                  swapState === "loading" ||
                  !amount ||
                  !quote ||
                  Boolean(sameToken) ||
                  insufficientBalance ||
                  belowMinimum
                }
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "mt-4 w-full",
                )}
              >
                {swapState === "loading"
                  ? "Swapping..."
                  : insufficientBalance
                    ? `Insufficient ${displayName(sellToken?.instrumentId ?? "")}`
                    : sameToken
                      ? "Select Different Tokens"
                      : belowMinimum
                        ? `Min ${MIN_SWAP_AMOUNT} CC to swap`
                        : !amount
                          ? "Enter Amount"
                          : `Swap ${displayName(sellToken?.instrumentId ?? "")} → ${displayName(buyToken?.instrumentId ?? "")}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Token Selector Modal (pop-up list with search) ──────────────────────

interface TokenPickerProps {
  open: boolean;
  onClose: () => void;
  tokens: SwapToken[];
  selectedToken: SwapToken | null;
  onSelect: (t: SwapToken) => void;
  excludeToken?: SwapToken | null;
}

function TokenPicker({
  open,
  onClose,
  tokens,
  onSelect,
  excludeToken,
}: TokenPickerProps) {
  const [search, setSearch] = useState("");
  if (!open) return null;

  const filtered = tokens.filter(
    (t) =>
      isSwapActive(t.instrumentId, t.isCC) &&
      (!excludeToken ||
        t.instrumentId !== excludeToken.instrumentId) &&
      t.instrumentId.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close token list"
        onClick={onClose}
      />
      <div className="relative z-10 my-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#0a0b0d] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Select Token</h3>
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
        {/* Search */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#13151a] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-amber-500/50"
          />
        </div>
        {/* List */}
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No tokens found.
            </p>
          ) : (
            filtered.map((t) => (
              <button
                key={`${t.instrumentId}::${t.instrumentAdmin}`}
                type="button"
                onClick={() => {
                  onSelect(t);
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-white/5"
              >
                <TokenLogo symbol={t.instrumentId} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {displayName(t.instrumentId)}
                    {t.isCC && (
                      <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                        CC
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {t.instrumentAdmin.slice(0, 20)}...
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Swap Card (slot) ────────────────────────────────────────────────────

interface SwapCardProps {
  label: string;
  amount?: string;
  onAmountChange?: (v: string) => void;
  isInput: boolean;
  balance?: string;
  onPercentClick?: (pct: number) => void;
  isLoading?: boolean;
  tokens: SwapToken[];
  selectedToken: SwapToken | null;
  onSelectToken: (t: SwapToken) => void;
  excludeToken?: SwapToken | null;
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
  tokens,
  selectedToken,
  onSelectToken,
  excludeToken,
  estimated,
}: SwapCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
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
                estimated
                  ? isLoading
                    ? "text-slate-600"
                    : "text-amber-300"
                  : "text-white",
              )}
            >
              {isLoading ? "…" : (amount || "0.0")}
            </span>
          )}

          {/* Token selector chip — klik buka picker */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-full bg-[#252a32] px-3 py-2 transition hover:bg-[#323842]"
          >
            {selectedToken ? (
              <>
                <TokenLogo symbol={selectedToken.instrumentId} size="sm" />
                <span className="text-sm font-semibold text-white">
                  {displayName(selectedToken.instrumentId)}
                </span>
              </>
            ) : (
              <span className="text-sm font-semibold text-slate-400">
                Select
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Token picker pop-up */}
      <TokenPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tokens={tokens}
        selectedToken={selectedToken}
        onSelect={onSelectToken}
        excludeToken={excludeToken}
      />
    </>
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
  if (n >= 1) return n.toFixed(2);
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
