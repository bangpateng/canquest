"use client";

/**
 * SendTokenSheet — P2P transfer token non-CC (USDCx, dll) ke user lain.
 *
 * On-chain two-step CIP-0056: POST /api/party/send-token membuat TransferInstruction
 * offer; receiver harus accept via Offers menu. Berbeda dari Send CC (sheet "send" di
 * wallet-actions.tsx) yang bisa direct kalau receiver punya preapproval.
 *
 * Saldo sumber kebenaran = on-chain (backend queryTokenHoldings), BUKAN DB. Fee in CC
 * (reuse TRANSACTION_FEE_CC) — sender butuh CC untuk fee.
 *
 * Token list + balances di-fetch dari /swap/pools + /swap/balances (mirror swap-modal).
 * Token selector filter by ACTIVE_SEND_TOKENS allowlist (USDCx duluan, arsitektur generic).
 */
import { useCallback, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  WalletToken,
  PoolsResponse,
  BalancesResponse,
  tokenBalanceKey,
} from "@/lib/canton/token-types";
import { normalizeSendRecipientInput } from "@/lib/canton/canton-party-id";
import { TokenLogo, displayName } from "@/components/app/wallet/token-logo";
import { useWalletPassword } from "@/lib/hooks/use-wallet-password";
import { WalletPasswordModal } from "@/components/app/wallet/wallet-password-modal";
import { ChevronDown, X, AlertCircle, Check, Search } from "lucide-react";

/** Token aktif untuk Send (selain CC). Lainnya = Coming Soon. Mirror swap allowlist. */
const ACTIVE_SEND_TOKENS = new Set(["USDCX"]);
function isSendActive(symbol: string): boolean {
  return ACTIVE_SEND_TOKENS.has(symbol.toUpperCase());
}

type SendState = "idle" | "loading" | "success" | "error";

interface SendTokenSheetProps {
  open: boolean;
  onClose: () => void;
  ccBalance?: number | null;
  onBalanceRefresh?: () => void;
}

export function SendTokenSheet({
  open,
  onClose,
  ccBalance,
  onBalanceRefresh,
}: SendTokenSheetProps) {
  const titleId = useId();
  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [balances, setBalances] = useState<BalancesResponse>({ cc: 0, tokens: {} });
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [feeCc, setFeeCc] = useState(5);

  const [selectedToken, setSelectedToken] = useState<WalletToken | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendMessage, setSendMessage] = useState("");

  const { hasPassword: hasWalletPassword } = useWalletPassword();
  const [pwOpen, setPwOpen] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);

  // Reset state saat sheet ditutup.
  useEffect(() => {
    if (!open) {
      setSendState("idle");
      setSendMessage("");
      setPickerOpen(false);
    }
  }, [open]);

  // Fetch fee config (mirror wallet-actions).
  useEffect(() => {
    fetch("/api/party/fee-config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { feeCc?: number } | null) => {
        if (d?.feeCc !== undefined) setFeeCc(d.feeCc);
      })
      .catch(() => {});
  }, []);

  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const [poolsRes, balRes] = await Promise.all([
        fetch("/api/party/swap/pools", { credentials: "include" }),
        fetch("/api/party/swap/balances", { credentials: "include" }),
      ]);
      const data = (await poolsRes.json()) as PoolsResponse & { message?: string };
      if (!poolsRes.ok) {
        setTokensError(data.message ?? "Could not load tokens.");
        return;
      }
      // Hanya token non-CC yang aktif untuk Send (CC pakai Send sheet biasa).
      const list = (data.tokens ?? []).filter(
        (t) => !t.isCC && isSendActive(t.instrumentId),
      );
      setTokens(list);
      if (list.length > 0 && !selectedToken) setSelectedToken(list[0]);
      if (balRes.ok) {
        const bal = (await balRes.json()) as BalancesResponse;
        setBalances(bal);
      }
    } catch {
      setTokensError("Network error. Check your connection.");
    } finally {
      setTokensLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) void loadTokens();
  }, [open, loadTokens]);

  const tokenBalance = selectedToken
    ? parseFloat(balances.tokens[tokenBalanceKey(selectedToken)] ?? "0")
    : 0;

  // CC balance untuk cek fee (in CC). ccBalance dari prop (DB cache) atau balances.cc.
  const ccAvail = typeof ccBalance === "number" ? ccBalance : balances.cc;
  const feeInsufficient = feeCc > 0 && ccAvail < feeCc;

  const filteredTokens = tokens.filter((t) =>
    t.instrumentId.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
  );

  const resetForm = () => {
    setRecipient("");
    setAmount("");
    setMemo("");
  };

  const doSubmit = useCallback(
    async (body: Record<string, unknown>) => {
      setSendState("loading");
      setSendMessage("");
      try {
        const res = await fetch("/api/party/send-token", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
          success?: boolean;
          offerPending?: boolean;
          transactionId?: string;
        } | null;

        // 403 = wallet password dibutuhkan (mirror send-cc flow).
        if (res.status === 403) {
          setPwOpen(true);
          setSendState("idle");
          return;
        }

        if (!res.ok || data?.success === false) {
          setSendState("error");
          setSendMessage(
            data?.message ?? data?.error ?? `Send failed (HTTP ${res.status}).`,
          );
          return;
        }

        setSendState("success");
        setSendMessage(
          data?.offerPending
            ? data.message ??
              `Offer created — recipient must accept via Offers menu.`
            : data?.message ?? "Token sent.",
        );
        resetForm();
        onBalanceRefresh?.();
      } catch {
        setSendState("error");
        setSendMessage("Network error. Check your connection.");
      }
    },
    [onBalanceRefresh],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedToken) return;
    const normalizedRecipient = normalizeSendRecipientInput(recipient);
    if (!normalizedRecipient) return;
    const amt = parseFloat(amount.trim());
    if (!Number.isFinite(amt) || amt <= 0) return;

    const body: Record<string, unknown> = {
      recipientUsername: normalizedRecipient,
      amount: amt,
      instrumentId: selectedToken.instrumentId,
      instrumentAdmin: selectedToken.instrumentAdmin,
      memo: memo.trim() || undefined,
      clientNonce:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    // Wallet password gate (opsional): kalau user punya password, tanya dulu.
    if (hasWalletPassword) {
      setPendingBody(body);
      setPwOpen(true);
      return;
    }
    void doSubmit(body);
  };

  const onPwSubmit = async (password: string) => {
    if (!pendingBody) return;
    await doSubmit({ ...pendingBody, walletPassword: password });
    setPwOpen(false);
    setPendingBody(null);
  };

  if (!open) return null;

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
        className="relative z-10 my-auto w-full max-w-md rounded-3xl border border-white/10 bg-[var(--card)] p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-slate-100">
            Send Token
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sendState === "success" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <p className="text-sm font-medium text-emerald-300">{sendMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSendState("idle");
                setSendMessage("");
              }}
              className={cn(buttonVariants({ size: "sm" }), "w-full")}
            >
              Send Another
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {tokensLoading ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner />
              </div>
            ) : tokensError ? (
              <div className="flex items-start gap-3 rounded-3xl border border-red-500/30 bg-red-500/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <p className="text-sm font-medium text-red-400">{tokensError}</p>
              </div>
            ) : tokens.length === 0 ? (
              <div className="rounded-3xl border border-white/5 bg-white/5 p-4 text-center">
                <p className="text-sm font-medium text-slate-400">
                  No sendable tokens yet. USDCx will appear here once available.
                </p>
              </div>
            ) : (
              <>
                {/* ── TOKEN SELECTOR ── */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Token</label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-2">
                      {selectedToken ? (
                        <>
                          <TokenLogo symbol={selectedToken.instrumentId} size="sm" />
                          <span className="font-bold text-slate-100">
                            {displayName(selectedToken.instrumentId)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">Select token</span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>

                  {pickerOpen && (
                    <div className="relative z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-[var(--card)] p-2 shadow-xl">
                      <div className="mb-2 flex items-center gap-2 px-2">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                          autoFocus
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder="Search token"
                          className="w-full bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                        />
                      </div>
                      {filteredTokens.map((t) => (
                        <button
                          key={tokenBalanceKey(t)}
                          type="button"
                          onClick={() => {
                            setSelectedToken(t);
                            setPickerOpen(false);
                            setPickerQuery("");
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-white/5"
                        >
                          <span className="flex items-center gap-2">
                            <TokenLogo symbol={t.instrumentId} size="sm" />
                            <span className="font-medium text-slate-100">
                              {displayName(t.instrumentId)}
                            </span>
                          </span>
                          <span className="text-xs tabular-nums text-slate-400">
                            {parseFloat(
                              balances.tokens[tokenBalanceKey(t)] ?? "0",
                            ).toFixed(4)}
                          </span>
                        </button>
                      ))}
                      {filteredTokens.length === 0 && (
                        <p className="px-3 py-2 text-sm text-slate-500">
                          No tokens match.
                        </p>
                      )}
                    </div>
                  )}
                  {selectedToken && (
                    <p className="text-xs text-slate-500">
                      On-chain balance:{" "}
                      <span className="tabular-nums text-slate-300">
                        {tokenBalance.toFixed(6)}{" "}
                        {displayName(selectedToken.instrumentId)}
                      </span>
                    </p>
                  )}
                </div>

                {/* ── RECIPIENT ── */}
                <div className="space-y-2">
                  <label
                    htmlFor="send-token-recipient"
                    className="text-sm font-medium text-slate-400"
                  >
                    Recipient{" "}
                    <span className="font-normal text-slate-500">
                      (@username or party id)
                    </span>
                  </label>
                  <input
                    id="send-token-recipient"
                    required
                    autoComplete="off"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="@alice or alice::1220…"
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-medium text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                {/* ── AMOUNT ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="send-token-amount"
                      className="text-sm font-medium text-slate-400"
                    >
                      Amount
                    </label>
                    {selectedToken && tokenBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(tokenBalance.toFixed(6))}
                        disabled={sendState === "loading"}
                        className="text-xs font-semibold text-[var(--primary)] hover:underline disabled:opacity-40"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                  <input
                    id="send-token-amount"
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 10"
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-bold tabular-nums text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                {/* ── MEMO ── */}
                <div className="space-y-2">
                  <label
                    htmlFor="send-token-memo"
                    className="text-sm font-medium text-slate-400"
                  >
                    Memo{" "}
                    <span className="font-normal text-slate-500">(optional)</span>
                  </label>
                  <input
                    id="send-token-memo"
                    autoComplete="off"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-medium text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                {/* ── FEE NOTICE (in CC) + two-step note ── */}
                <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-center">
                  <p className="text-sm font-semibold text-slate-200">
                    Fee: {feeCc} CC
                  </p>
                  <p className="text-xs text-slate-500">
                    Recipient must accept the transfer via Offers menu (two-step).
                  </p>
                  {feeInsufficient && (
                    <p className="mt-1 text-xs font-medium text-amber-400">
                      Insufficient CC for fee ({ccAvail.toFixed(2)} available).
                    </p>
                  )}
                </div>

                {sendState === "error" && (
                  <div className="flex items-start gap-3 rounded-3xl border border-red-500/30 bg-red-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                    <p className="text-sm font-medium text-red-400">{sendMessage}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={sendState === "loading" || !selectedToken}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "mt-4 w-full sm:w-auto gap-2",
                  )}
                >
                  {sendState === "loading" ? (
                    <>
                      <LoadingSpinner size="sm" />
                      Sending…
                    </>
                  ) : (
                    "Send Token"
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sendState === "loading"}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "w-full sm:w-auto",
                  )}
                >
                  Cancel
                </button>
              </>
            )}
          </form>
        )}
      </div>

      <WalletPasswordModal
        open={pwOpen}
        actionLabel="Send Token"
        busy={sendState === "loading"}
        onClose={() => {
          setPwOpen(false);
          setPendingBody(null);
        }}
        onConfirm={onPwSubmit}
      />
    </div>
  );
}
