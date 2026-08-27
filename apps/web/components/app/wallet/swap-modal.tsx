"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { TxReviewModal } from "@/components/app/wallet/tx-review-modal";
import { useMe } from "@/lib/hooks/use-me";
import { signRelayPrepared } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";
import {
  ArrowDown,
  ChevronDown,
  X,
  AlertCircle,
  Search,
  Settings2,
  Route,
} from "lucide-react";

/** Token aktif untuk swap (selain CC). Lainnya = Coming Soon.
 *  Reuse dari shared token-types (single source of truth). */
import { isTokenActive as isSwapActive } from "@/lib/canton/token-types";

// ── Types ───────────────────────────────────────────────────────────────
// Reuse WalletToken dari shared token-types (tidak duplikasi).
import type { WalletToken as SwapToken } from "@/lib/canton/token-types";

/** Quote response dari POST /api/party/swap/quote — shape OneSwap native
 *  sesuai dokumentasi Quote type. Semua field numeric.
 *
 *  Alur fee (input token):
 *    amount (input user)
 *      − networkFeeIn   (biaya Canton network, dipotong dari input — gasless)
 *      = effInput       (input aktual yang di-swap ke pool)
 *      − lpFee+platformFee (dekomposisi pool fee = swapFeeBps)
 *      → dikonversi ke amountOut (output yang dibeli user) */
interface QuoteResponse {
  /** Estimasi output (token yang dibeli). */
  amountOut: number;
  /** Price impact trade ini (persen). */
  priceImpactPct: number;
  /** Input aktual di-swap SETELAH networkFeeIn dipotong. */
  effInput: number;
  /** Biaya Canton network (dipotong dari input — user tidak butuh gas CC). */
  networkFeeIn: number;
  /** Potongan platform dari pool fee (di input token). */
  platformFee: number;
  /** Potongan LP dari pool fee (di input token). */
  lpFee: number;
  /** Fee pool total (basis points), sebelum diskon. */
  swapFeeBps: number;
  /** Fee efektif (basis points) setelah diskon. */
  effFeeBps: number;
  /** Pool yang dipakai (transparansi). */
  poolId: string;
  /** Symbol input. */
  inSym: string;
}

/** Minimum swap amount — DEFAULT fallback kalau backend tidak kirim nilai.
 *  Nilai aktual dari env backend (ONESWAP_MIN_AMOUNT_CC / _TOKEN) via
 *  GET /swap/status → state minAmountCc / minAmountToken. */
const MIN_SWAP_AMOUNT_CC_FALLBACK = 10;
const MIN_SWAP_AMOUNT_TOKEN_FALLBACK = 2.5;

interface SwapModalProps {
  open: boolean;
  onClose: () => void;
  balance?: number | null;
}

import {
  TokenLogo,
  displayName,
} from "@/components/app/wallet/token-logo";
import {
  useBalances,
  usePools,
  useInvalidateWalletTokens,
} from "@/lib/hooks/use-wallet-tokens";

// ── Component ───────────────────────────────────────────────────────────

export function SwapModal({ open, onClose, balance }: SwapModalProps) {
  const titleId = useId();
  const tx = useTransactionStatus();
  // M3b: user external → leg input swap di-sign di browser.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();

  // WAVE 6 real-time: pools & saldo dari TanStack Query (auto-refresh saat SSE
  // balance:changed masuk). Key dishared dengan TokenList/WalletActions parent
  // → ter-dedup, tidak ada double-fetch saat SwapModal dibuka.
  const invalidateWalletTokens = useInvalidateWalletTokens();
  const poolsQuery = usePools({ enabled: open });
  const { data: balancesData } = useBalances({ enabled: open });

  const tokens = poolsQuery.data?.tokens ?? [];
  const tokensLoading = poolsQuery.isLoading;
  const tokensError = poolsQuery.error ? "Could not load tokens." : null;

  // Two independent slots — user can pick any token in either.
  const [sellToken, setSellToken] = useState<SwapToken | null>(null);
  const [buyToken, setBuyToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [statusEnabled, setStatusEnabled] = useState(true);
  // Minimum swap dari backend (env ONESWAP_MIN_AMOUNT_*). Fallback ke konstanta
  // kalau status response tidak kirim nilai (mis. backend lama / fetch gagal).
  const [minAmountCc, setMinAmountCc] = useState(MIN_SWAP_AMOUNT_CC_FALLBACK);
  const [minAmountToken, setMinAmountToken] = useState(
    MIN_SWAP_AMOUNT_TOKEN_FALLBACK,
  );

  // Swap execution state.
  const [swapState, setSwapState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [swapMessage, setSwapMessage] = useState("");
  const [swapOutput, setSwapOutput] = useState("");
  const [swapReceivedToken, setSwapReceivedToken] = useState("");
  /** true = swap masih diproses OneSwap di background (hasil via notifikasi). */
  const [swapPending, setSwapPending] = useState(false);

  // Slippage tolerance (client-controlled; passed to the swap endpoint, ignored
  // if unsupported). "Minimum received" is computed honestly from the quote.
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [slippage, setSlippage] = useState(0.5);

  // Tahap REVIEW (Input → Review → Sign → Broadcast → Success/Failed):
  // tombol Swap buka review dulu; eksekusi jalan saat Confirm.
  const [reviewOpen, setReviewOpen] = useState(false);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Check swap status on open. Juga ambil min amount dari env backend.
  useEffect(() => {
    if (!open) return;
    fetch("/api/party/swap/status", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: {
          enabled?: boolean;
          message?: string;
          minAmountCc?: number;
          minAmountToken?: number;
        }) => {
          setStatusEnabled(Boolean(d.enabled));
          setStatus(d.message ?? null);
          if (typeof d.minAmountCc === "number") setMinAmountCc(d.minAmountCc);
          if (typeof d.minAmountToken === "number")
            setMinAmountToken(d.minAmountToken);
        },
      )
      .catch(() => setStatus(null));
  }, [open]);

  // Default sell/buy token selection — derived from the pools query. Picks
  // sell = CC (Amulet), buy = first non-CC token once tokens are available.
  // Runs only when neither slot is set yet (first load / modal reopened).
  useEffect(() => {
    if (!open || !statusEnabled || tokens.length === 0) return;
    if (sellToken && buyToken) return;
    const cc = tokens.find((t) => t.isCC);
    const firstNonCC = tokens.find((t) => !t.isCC);
    setSellToken(cc ?? tokens[0] ?? null);
    setBuyToken(firstNonCC ?? (tokens[1] ?? null));
  }, [open, statusEnabled, tokens, sellToken, buyToken]);

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
            from: sellToken.symbol ?? (sellToken.isCC ? "CC" : sellToken.instrumentId),
            to: buyToken.symbol ?? (buyToken.isCC ? "CC" : buyToken.instrumentId),
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
  }, [amount, sellToken, buyToken]);

  if (!open) return null;

  const sellIsCC = Boolean(sellToken?.isCC);
  // WAVE 6 real-time: saldo dari useBalances hook (auto-refresh SSE).
  // Fallback ke prop `balance` (CC) saat hook masih loading.
  const ccBalanceEffective =
    typeof balancesData?.cc === "number"
      ? balancesData.cc
      : typeof balance === "number"
        ? balance
        : 0;
  const tokensMap = balancesData?.tokens ?? {};
  // DB-DRIVEN: balance key = instrumentId (lowercase), bukan composite id::admin.
  const sellBalance = sellToken
    ? sellIsCC
      ? ccBalanceEffective
      : parseFloat(tokensMap[sellToken.instrumentId.toLowerCase()] ?? "0")
    : 0;
  const insufficientBalance =
    sellBalance > 0 && parseFloat(amount) > sellBalance;
  const sameToken =
    sellToken && buyToken && sellToken.instrumentId === buyToken.instrumentId;
  // Minimum amount gate — dinamis dari env backend (ONESWAP_MIN_AMOUNT_*).
  const minAmount = sellToken?.isCC ? minAmountCc : minAmountToken;
  const belowMinimum =
    parseFloat(amount) > 0 &&
    parseFloat(amount) < minAmount;

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

    const sellSym = sellToken.symbol ?? (sellToken.isCC ? "CC" : sellToken.instrumentId);
    const buySym = buyToken.symbol ?? (buyToken.isCC ? "CC" : buyToken.instrumentId);
    const estOut = quote ? formatAmountNum(quote.amountOut) : "0";
    tx.start({
      amountText: `${formatAmountNum(parseFloat(amount))} ${displayName(sellToken.instrumentId)} → ${estOut} ${displayName(buyToken.instrumentId)}`,
      title: "Swap complete",
      subtitle: `Received ${estOut} ${displayName(buyToken.instrumentId)}`,
      accentBg: "bg-[var(--primary)]/15",
      accentText: "text-canton",
    });

    try {
      // ── M3b: user EXTERNAL — tanda tangani leg input di browser dulu ──
      const clientNonce =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let externalDepositDone = false;
      if (isExternalWallet) {
        const prep = await fetch("/api/party/swap/prepare-external", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: sellSym,
            to: buySym,
            amount: parseFloat(amount),
            clientNonce,
          }),
        });
        const prepRaw = (await prep.json().catch(() => null)) as {
          hash?: string;
          description?: string;
          message?: string;
        } | null;
        if (!prep.ok || !prepRaw?.hash) {
          const msg = prepRaw?.message ?? "Failed to prepare swap.";
          tx.fail(msg);
          setSwapState("error");
          setSwapMessage(msg);
          return;
        }
        try {
          await signRelayPrepared(
            { hash: prepRaw.hash, description: prepRaw.description },
            {
              onWalletLocked: () =>
                promptPassphrase(
                  `Swap ${formatAmountNum(parseFloat(amount))} ${displayName(sellToken.instrumentId)}`,
                ),
            },
          );
          externalDepositDone = true;
        } catch (err) {
          const msg =
            err instanceof Error && err.message
              ? err.message
              : "Swap failed while signing.";
          tx.fail(msg);
          setSwapState("error");
          setSwapMessage(msg);
          return;
        }
      }
      tx.broadcast();

      const res = await fetch("/api/party/swap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: sellSym,
          to: buySym,
          amount: parseFloat(amount),
          slippagePct: slippage,
          clientNonce,
          ...(externalDepositDone ? { externalDepositDone: true } : {}),
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        pending?: boolean;
        outputAmount?: string;
        message?: string;
      };
      if (!res.ok || !data.success) {
        const msg = data.message ?? "Swap failed. Please try again.";
        tx.fail(msg);
        setSwapState("error");
        setSwapMessage(msg);
        return;
      }
      // ASYNC: submit diterima — OneSwap menyelesaikan di background.
      // Modal sukses auto-tutup ±2.5 detik; hasil final masuk via SSE
      // (swap:completed) + badge notifikasi seperti transaksi lain.
      setSwapState("success");
      setSwapOutput(data.outputAmount ?? estOut);
      setSwapReceivedToken(buyToken?.instrumentId ?? "");
      setSwapPending(Boolean(data.pending));
      // Leg deposit sudah on-chain saat sign — refresh saldo sell sekarang;
      // saldo buy menyusul via SSE swap:completed (listener use-realtime).
      void invalidateWalletTokens();

      tx.succeed({
        amountText: `${formatAmountNum(parseFloat(amount))} ${displayName(sellToken.instrumentId)} → ${data.outputAmount ?? estOut} ${displayName(buyToken.instrumentId)}`,
        title: data.pending ? "Swap submitted" : "Swap complete",
        subtitle: data.pending
          ? "Completing in the background — watch your notifications."
          : `Received ${data.outputAmount ?? estOut} ${displayName(buyToken.instrumentId)}`,
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
        meta: quote
          ? [
              {
                label: "Rate",
                value: `1 ${displayName(sellToken.instrumentId)} ≈ ${formatPriceNum(quote.amountOut / (quote.effInput || parseFloat(amount) || 1))} ${displayName(buyToken.instrumentId)}`,
              },
              { label: "Min received", value: `${formatAmountNum(quote.amountOut * (1 - slippage / 100))} ${displayName(buyToken.instrumentId)}` },
            ]
          : undefined,
      });
    } catch {
      tx.fail("Network error. Check your connection.");
      setSwapState("error");
      setSwapMessage("Network error. Check your connection.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
      role="presentation"
    >
      {/* M3b: prompt passphrase leg input swap (user external). */}
      {passphraseModal}

      {/* Tahap REVIEW sebelum eksekusi (Input → Review → Sign → Broadcast). */}
      <TxReviewModal
        open={reviewOpen}
        title="Confirm swap"
        amountText={`${formatAmountNum(parseFloat(amount || "0"))} ${displayName(sellToken?.instrumentId ?? "")} → ${quote ? formatAmountNum(quote.amountOut) : "…"} ${displayName(buyToken?.instrumentId ?? "")}`}
        subText="Best route via OneSwap"
        rows={[
          {
            label: "You pay",
            value: `${formatAmountNum(parseFloat(amount || "0"))} ${displayName(sellToken?.instrumentId ?? "")}`,
          },
          {
            label: "You get (est.)",
            value: quote
              ? `${formatAmountNum(quote.amountOut)} ${displayName(buyToken?.instrumentId ?? "")}`
              : "…",
          },
          ...(quote
            ? [
                {
                  label: "Rate",
                  value: `1 ${displayName(sellToken?.instrumentId ?? "")} ≈ ${formatPriceNum(quote.amountOut / (quote.effInput || parseFloat(amount) || 1))} ${displayName(buyToken?.instrumentId ?? "")}`,
                },
                {
                  label: "Min received",
                  value: `${formatAmountNum(quote.amountOut * (1 - slippage / 100))} ${displayName(buyToken?.instrumentId ?? "")}`,
                },
                {
                  label: "Network fee",
                  value: `${formatAmountNum(quote.networkFeeIn)} ${displayName(sellToken?.instrumentId ?? "")}`,
                },
                {
                  label: "Pool fee",
                  value: `${(quote.effFeeBps / 100).toFixed(2)}%`,
                },
              ]
            : []),
          { label: "Max slippage", value: `${slippage}%` },
          { label: "Network", value: "Canton" },
        ]}
        note="Output is estimated — it may change slightly before confirmation."
        confirmLabel="Confirm Swap"
        onClose={() => setReviewOpen(false)}
        onConfirm={() => {
          setReviewOpen(false);
          void submitSwap();
        }}
      />
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-[var(--foreground)]">
            Swap
          </h2>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSlippageOpen((v) => !v)}
                className={iconButtonClass("h-8 w-8")}
                aria-label="Slippage settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              {slippageOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3.5 shadow-xl">
                  <p className="text-xs font-semibold text-[var(--foreground)]">Slippage tolerance</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    {[0.1, 0.5, 1.0].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSlippage(v)}
                        className={cn(
                          "flex-1 rounded-lg border py-1.5 text-xs font-semibold",
                          slippage === v
                            ? "border-canton-muted bg-canton-subtle text-canton"
                            : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
                        )}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    Your swap will revert if the price moves unfavorably by more than this amount.
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={iconButtonClass("h-8 w-8")}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status banner */}
        {!statusEnabled ? (
          <div className="mb-4 rounded-xl border border-canton-muted bg-canton-subtle p-3 text-center text-xs text-canton">
            {status ?? "Swap is not available right now."}
          </div>
        ) : null}

        {/* Loading state */}
        {tokensLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner className="h-6 w-6" />
          </div>
        ) : tokensError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{tokensError}</span>
          </div>
        ) : tokens.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
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
              <div className="relative z-10 -my-2 flex justify-center">
                <button
                  type="button"
                  onClick={flipTokens}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-[var(--card)] bg-[var(--muted)] text-canton transition hover:rotate-180 hover:bg-[var(--primary)]/10"
                  aria-label="Flip tokens"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              {/* ── SLOT BAWAH (buy) ── */}
              <SwapCard
                label="You Get (est.)"
                amount={quote ? formatAmountNum(quote.amountOut) : ""}
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
              <p className="mt-3 text-center text-sm text-canton">
                Select different tokens to swap.
              </p>
            )}

            {/* Insufficient balance */}
            {insufficientBalance && (
              <p className="mt-3 text-center text-sm font-medium text-red-600">
                Insufficient {displayName(sellToken?.instrumentId ?? "")} balance
              </p>
            )}

            {/* Quote details */}
            {!sameToken &&
              (quoteError ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{quoteError}</span>
                </div>
              ) : quote ? (
                <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-xs">
                  <DetailRow
                    label="Rate"
                    value={`1 ${displayName(sellToken?.instrumentId ?? "")} ≈ ${formatPriceNum(quote.amountOut / (quote.effInput || parseFloat(amount) || 1))} ${displayName(buyToken?.instrumentId ?? "")}`}
                  />
                  <DetailRow
                    label="Price Impact"
                    value={`${quote.priceImpactPct.toFixed(2)}%`}
                    valueClass={
                      quote.priceImpactPct > 3
                        ? "text-red-600"
                        : "text-emerald-600"
                    }
                  />
                  <DetailRow label="Max slippage" value={`${slippage}%`} />
                  <DetailRow
                    label="Minimum received"
                    value={`${formatAmountNum(quote.amountOut * (1 - slippage / 100))} ${displayName(buyToken?.instrumentId ?? "")}`}
                  />
                  <DetailRow
                    label="Pool Fee"
                    value={`${(quote.effFeeBps / 100).toFixed(2)}% (${formatAmountNum(quote.lpFee + quote.platformFee)} ${displayName(sellToken?.instrumentId ?? "")})`}
                  />
                  <DetailRow
                    label="Network Fee"
                    value={`${formatAmountNum(quote.networkFeeIn)} ${displayName(sellToken?.instrumentId ?? "")}`}
                  />
                </div>
              ) : null)}

            {/* CTA / Swap execution */}
            {swapState === "success" ? (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-600">
                  {swapPending ? "Swap submitted!" : "Swap completed!"}
                </p>
                {swapOutput && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {swapPending ? "≈" : "Received"} {swapOutput}{" "}
                    {displayName(swapReceivedToken || (buyToken?.instrumentId ?? ""))}
                    {swapPending
                      ? " expected — arriving in your wallet shortly"
                      : ""}
                  </p>
                )}
                {swapPending ? (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    You&apos;ll get a notification when it completes.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSwapState("idle");
                    setAmount("");
                    setSwapPending(false);
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
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
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
                onClick={() => setReviewOpen(true)}
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
                        ? `Min ${minAmount} ${sellToken?.isCC ? "CC" : (sellToken?.instrumentId ?? "token")} to swap`
                        : !amount
                          ? "Enter Amount"
                          : `Swap ${displayName(sellToken?.instrumentId ?? "")} → ${displayName(buyToken?.instrumentId ?? "")}`}
              </button>
            )}
          </>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs font-medium text-[var(--muted-foreground)]">
          <Route className="h-3 w-3" />
          Best route via OneSwap
        </p>
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
        className="modal-backdrop"
        aria-label="Close token list"
        onClick={onClose}
      />
      <div className="relative z-10 my-auto max-h-[calc(100dvh-6.75rem)] md:max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--foreground)]">Select Token</h3>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass(
              "h-8 w-8",
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Search */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Search token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/50"
          />
        </div>
        {/* List */}
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
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
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[var(--primary)]/5"
              >
                <TokenLogo symbol={t.instrumentId} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {displayName(t.instrumentId)}
                    {t.isCC && (
                      <span className="ml-1.5 rounded bg-canton-subtle px-1.5 py-0.5 text-[10px] font-bold text-canton">
                        CC
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
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
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
          {isInput && balance && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--muted-foreground)]">Bal: {balance}</span>
              {onPercentClick && (
                <div className="flex gap-1">
                  {[0.25, 0.5, 0.75].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onPercentClick(p)}
                      className="rounded bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--primary)]/10 hover:text-canton"
                    >
                      {p === 0.25 ? "25" : p === 0.5 ? "50" : "75"}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onPercentClick(1)}
                    className="rounded bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-semibold text-canton ring-1 ring-[var(--border)] hover:bg-[var(--primary)]/10"
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
              className="w-full min-w-0 flex-1 bg-transparent text-2xl font-bold text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/60"
            />
          ) : (
            <span
              className={cn(
                "w-full min-w-0 flex-1 text-2xl font-bold",
                estimated
                  ? isLoading
                    ? "text-[var(--muted-foreground)]"
                    : "text-canton"
                  : "text-[var(--foreground)]",
              )}
            >
              {isLoading ? "…" : (amount || "0.0")}
            </span>
          )}

          {/* Token selector chip — klik buka picker */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-full bg-[var(--card)] px-3 py-2 ring-1 ring-[var(--border)] transition hover:bg-[var(--primary)]/10"
          >
            {selectedToken ? (
              <>
                <TokenLogo symbol={selectedToken.instrumentId} size="sm" />
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {displayName(selectedToken.instrumentId)}
                </span>
              </>
            ) : (
              <span className="text-sm font-semibold text-[var(--muted-foreground)]">
                Select
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
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
    <div className="flex items-center justify-between gap-2 text-[var(--muted-foreground)]">
      <span>{label}</span>
      <span className={cn("font-medium text-[var(--muted-foreground)]", valueClass)}>
        {value}
      </span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────
// OneSwap quote fields are numeric — these take numbers directly.

/** Format a token amount for display. */
function formatAmountNum(n: number): string {
  if (!isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

/** Format a price/exchange-rate for display. */
function formatPriceNum(n: number): string {
  if (!isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}
