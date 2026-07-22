"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { CopyField } from "@/components/app/wallet/copy-field";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import {
  formatPartyIdForDisplay,
  normalizeSendRecipientInput,
} from "@/lib/canton/canton-party-id";
import { cn } from "@/lib/utils/utils";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { OffersModal, useOffers, useSentOffers } from "@/components/app/wallet/offers-section";
import { SwapModal } from "@/components/app/wallet/swap-modal";
import { WalletPasswordModal } from "@/components/app/wallet/wallet-password-modal";
import { useWalletPassword } from "@/lib/hooks/use-wallet-password";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  X,
  AlertCircle,
  Inbox,
  ChevronDown,
  Search,
  Activity as ActivityIcon,
  Lock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WalletToken,
  BalancesResponse,
  tokenBalanceKey,
} from "@/lib/canton/token-types";
import {
  usePools,
  useBalances,
  useInvalidateWalletTokens,
} from "@/lib/hooks/use-wallet-tokens";
import { TokenLogo, displayName } from "@/components/app/wallet/token-logo";

type Sheet = null | "send" | "receive" | "offers" | "swap";
type SendState = "idle" | "loading" | "success" | "error";

interface WalletActionsProps {
  partyId: string;
  balance?: number | null;
  onBalanceRefresh?: () => void;
  /** Buka CcLockModal (modal dimiliki TokenList parent). */
  onLockClick?: () => void;
  /** Jumlah CC yang sedang terkunci (untuk badge di tombol Lock). 0 = tidak ada. */
  lockedCc?: number;
}

export function WalletActions({
  partyId,
  balance,
  onBalanceRefresh,
  onLockClick,
  lockedCc = 0,
}: WalletActionsProps) {
  const displayPartyId = formatPartyIdForDisplay(partyId);
  const sendTitleId = useId();
  const receiveTitleId = useId();
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [feeCc, setFeeCc] = useState(5);

  // Pending incoming offers — badge count + modal content.
  const { offers, loading: offersLoading, error: offersError, setOffers, refresh: refreshOffers } = useOffers();
  // Pending outgoing (sent) offers — tab Sent di modal (Withdraw).
  const {
    sentOffers,
    loading: sentOffersLoading,
    error: sentOffersError,
    setOffers: setSentOffers,
    refresh: refreshSentOffers,
  } = useSentOffers();
  // Badge total: incoming + outgoing supaya user tahu ada aksi pending.
  const offersCount = offers.length + sentOffers.length;

  // Fetch fee config from backend env so UI stays in sync with .env
  useEffect(() => {
    fetch("/api/party/fee-config", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { feeCc?: number } | null) => { if (d?.feeCc !== undefined) setFeeCc(d.feeCc); })
      .catch(() => {});
  }, []);

  // ── Token list untuk Send unified (CC + USDCx + token aktif lainnya) ──
  // Satu UI Send untuk semua token. CC = route /send-cc (preapproval path),
  // non-CC = route /send-token (CIP-0056 two-step). User tidak perlu sadar bedanya.
  //
  // Pools & balances lewat react-query dengan query key dishared dengan
  // TokenList (parent). Karena parent sudah mount hook ini, request ter-dedup
  // — sebelumnya WalletActions fetch pools+balances sendiri (duplikat 2x).
  const poolsQuery = usePools({ enabled: true });
  const balancesQuery = useBalances({ enabled: true });
  const invalidateWalletTokens = useInvalidateWalletTokens();

  const [selectedSendToken, setSelectedSendToken] = useState<WalletToken | null>(null);
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [tokenPickerQuery, setTokenPickerQuery] = useState("");

  // Token aktif untuk Send (selain CC). Mirror swap allowlist supaya konsisten —
  // hanya token yang benar-benar supported yang muncul di selector.
  const ACTIVE_SEND_TOKENS = new Set(["USDCX"]);
  function isSendActive(t: WalletToken): boolean {
    if (t.isCC) return true; // CC selalu aktif
    return ACTIVE_SEND_TOKENS.has(t.instrumentId.toUpperCase());
  }

  // Turunkan list token untuk selector Send (filter KNOWN_TOKENS, default CC).
  // Tampilkan SEMUA token: CC selalu aktif. Non-CC aktif + coming soon.
  // (Hanya tampilkan token yang dikenal — bukan semua token Cantex random).
  const KNOWN_TOKENS = new Set(["USDCX", "CBTC"]);
  const sendTokens = (poolsQuery.data?.tokens ?? []).filter(
    (t) => t.isCC || KNOWN_TOKENS.has(t.instrumentId.toUpperCase()),
  );
  const sendBalances: BalancesResponse = balancesQuery.data ?? { cc: 0, tokens: {} };

  // Default: CC (Amulet) — set sekali saat data pools tersedia.
  useEffect(() => {
    if (selectedSendToken || sendTokens.length === 0) return;
    const cc = sendTokens.find((t) => t.isCC);
    setSelectedSendToken(cc ?? sendTokens[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendTokens.length]);

  // Balance untuk token yang sedang dipilih (CC dari prop, non-CC dari /balances).
  const selectedIsCC = Boolean(selectedSendToken?.isCC);
  const selectedBalance = selectedSendToken
    ? selectedIsCC
      ? typeof balance === "number"
        ? balance
        : sendBalances.cc
      : parseFloat(sendBalances.tokens[tokenBalanceKey(selectedSendToken)] ?? "0")
    : 0;

  // Send form state
  const [recipientUsername, setRecipientUsername] = useState("");
  const [ccAmount, setCcAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendMessage, setSendMessage] = useState("");
  const [successTransactionId, setSuccessTransactionId] = useState<string | null>(null);

  // Gate kata sandi transaksi (opsional). Modal muncul hanya bila user menetapkan satu.
  const { hasPassword: hasWalletPassword } = useWalletPassword();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwError, setPwError] = useState("");

  const close = useCallback(() => {
    setSheet(null);
    setSendState("idle");
    setSendMessage("");
  }, []);

  const closeSuccessReceipt = useCallback(() => {
    setSuccessTransactionId(null);
    setSendState("idle");
    setSendMessage("");
  }, []);

  useEffect(() => {
    if (!sheet) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, close]);

  function openSend() {
    setRecipientUsername("");
    setCcAmount("");
    setMemo("");
    setSendState("idle");
    setSendMessage("");
    setTokenPickerOpen(false);
    setTokenPickerQuery("");
    // Default CC bila belum ada token terpilih.
    if (!selectedSendToken) {
      const cc = sendTokens.find((t) => t.isCC) ?? sendTokens[0] ?? null;
      setSelectedSendToken(cc);
    }
    setSheet("send");
  }

  // Konfirmasi password dari modal → lanjutkan send dengan password tersebut.
  function confirmSendPassword(password: string) {
    setPwError("");
    // submitSend butuh event; buat event sintetis agar e.preventDefault() aman.
    void submitSend(
      { preventDefault: () => {} } as React.FormEvent,
      password,
    );
  }

  function closePasswordModal() {
    setPwOpen(false);
    setPwError("");
    setSendState("idle");
  }

  async function submitSend(e: React.FormEvent, password?: string) {
    e.preventDefault();
    // Gate: bila user menetapkan wallet password dan belum ada input, buka modal.
    if (hasWalletPassword && !password) {
      setPwError("");
      setPwOpen(true);
      return;
    }
    const recipient = normalizeSendRecipientInput(recipientUsername);
    const amount = parseFloat(ccAmount.trim());
    if (!recipient || !amount || amount <= 0) return;
    if (!selectedSendToken) return;

    setSendState("loading");
    setSendMessage("");

    // ── AUTO-ROUTE: CC → /send-cc, non-CC → /send-token ──────────────────
    // User pilih token di selector, tidak sadar backend beda. CC pakai jalur
    // lama (preapproval path, bisa direct). Non-CC pakai CIP-0056 two-step.
    const isCC = Boolean(selectedSendToken.isCC);
    const nonce =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const endpoint = isCC ? "/api/party/send-cc" : "/api/party/send-token";
    const payload: Record<string, unknown> = {
      recipientUsername: recipient,
      amount,
      memo: memo.trim() || undefined,
      clientNonce: nonce,
      ...(password ? { walletPassword: password } : {}),
    };
    if (!isCC) {
      payload.instrumentId = selectedSendToken.instrumentId;
      payload.instrumentAdmin = selectedSendToken.instrumentAdmin;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        message?: string;
        error?: string;
        totalDeducted?: number;
        fee?: number;
        feeCollected?: boolean;
        warning?: string;
        success?: boolean;
        accepted?: boolean;
        offerPending?: boolean;
        offerContractId?: string;
        transferInstructionCid?: string;
        transactionId?: string;
        to?: string;
        transferMethod?: string;
      };

      // Error hanya jika HTTP error ATAU success=false
      // accepted=false + offerPending=true = offer berhasil dibuat, receiver perlu accept manual (BUKAN error)
      if (!res.ok || data.success === false) {
        // 403 = wallet password salah / terkunci — tahan di modal untuk coba lagi.
        if (res.status === 403) {
          setPwOpen(true);
          setPwError(
            data.message ?? data.error ?? "Wrong wallet password.",
          );
          setSendState("idle");
          return;
        }
        setSendState("error");
        setSendMessage(data.message ?? data.error ?? "Transfer failed. Please try again.");
        return;
      }

      // Sukses → tutup modal password (jika terbuka) dan reset gate.
      setPwOpen(false);
      setSheet(null);
      setSendState("idle");
      const tokenLabel = displayName(selectedSendToken.instrumentId);
      if (typeof data.transactionId === "string" && data.transactionId) {
        setSuccessTransactionId(data.transactionId);
      } else if (data.offerPending) {
        // Offer berhasil dibuat tapi receiver harus accept manual (two-step).
        setSendState("success");
        setSendMessage(
          data.message ??
            `Transfer offer sent for ${amount} ${tokenLabel}. The recipient must accept it from their wallet.`,
        );
        setSheet("send");
      } else {
        setSendState("success");
        setSendMessage(
          data.message ??
            `Sent ${amount} ${tokenLabel}` +
              (isCC && data.feeCollected && data.fee
                ? ` (fee ${data.fee} CC, total ${data.totalDeducted ?? amount + data.fee} CC)`
                : ""),
        );
        setSheet("send");
      }
      onBalanceRefresh?.();
      // Refresh token balances supaya balance selector update (non-CC credit).
      void invalidateWalletTokens();
    } catch {
      setSendState("error");
      setSendMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <>
      <div className="grid w-full min-w-0 grid-cols-3 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={openSend}
          className={cn(buttonVariants({ size: "sm" }), "w-full justify-center gap-2")}
        >
          <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden />
          Send
        </button>
        <button
          type="button"
          onClick={() => setSheet("receive")}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "w-full justify-center gap-2",
          )}
        >
          <ArrowDownLeft className="h-5 w-5 shrink-0" aria-hidden />
          Receive
        </button>
        <button
          type="button"
          onClick={() => setSheet("offers")}
          aria-label={`Incoming offers${offersCount > 0 ? `, ${offersCount} pending` : ""}`}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "relative w-full justify-center gap-2",
            offersCount > 0 &&
              "border-emerald-500/40 text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10",
          )}
        >
          <Inbox className="h-5 w-5 shrink-0" aria-hidden />
          Offers
          {offersCount > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white shadow ring-2 ring-[var(--card)]"
              aria-hidden
            >
              {offersCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSheet("swap")}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "w-full justify-center gap-2",
          )}
        >
          <ArrowLeftRight className="h-5 w-5 shrink-0" aria-hidden />
          Swap
        </button>
        <button
          type="button"
          onClick={() => onLockClick?.()}
          aria-label={lockedCc > 0 ? `Lock — ${lockedCc} CC locked` : "Lock"}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "relative w-full justify-center gap-2",
            lockedCc > 0 &&
              "border-emerald-500/40 text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10",
          )}
        >
          <Lock className="h-5 w-5 shrink-0" aria-hidden />
          Lock
          {lockedCc > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white shadow ring-2 ring-[var(--card)]"
              aria-hidden
            >
              {lockedCc > 999 ? "999+" : lockedCc}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => router.push("/activity")}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "w-full justify-center gap-2",
          )}
        >
          <ActivityIcon className="h-5 w-5 shrink-0" aria-hidden />
          Activity
        </button>
      </div>

      {/* Lock modal dimiliki oleh TokenList (/wallet utama), bukan di sini. */}

      {/* ── SEND DIALOG ── */}
      {sheet === "send" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="presentation"
        >
          <button
            type="button"
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={sendTitleId}
            className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-8 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={sendTitleId}
                  className="text-xl font-bold text-slate-100"
                >
                  Send
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className={iconButtonClass("h-9 w-9 shrink-0 text-[var(--foreground)]")}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {sendState === "success" ? (
              <div className="mt-6 flex flex-col items-center gap-4 py-4 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">{sendMessage}</p>
                <button
                  type="button"
                  onClick={close}
                  className={cn(buttonVariants({ size: "sm" }), "mt-2")}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submitSend} className="mt-8 space-y-6">
                {/* ── TOKEN SELECTOR (CC + USDCx + token aktif lainnya) ── */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Token</label>
                  <button
                    type="button"
                    onClick={() => setTokenPickerOpen((v) => !v)}
                    disabled={sendState === "loading"}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      {selectedSendToken ? (
                        <>
                          <TokenLogo symbol={selectedSendToken.instrumentId} size="sm" />
                          <span className="font-bold text-slate-100">
                            {displayName(selectedSendToken.instrumentId)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">Select token</span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>

                  {tokenPickerOpen && (
                    <div className="relative z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-[var(--card)] p-2 shadow-xl">
                      <div className="mb-2 flex items-center gap-2 px-2">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                          autoFocus
                          value={tokenPickerQuery}
                          onChange={(e) => setTokenPickerQuery(e.target.value)}
                          placeholder="Search token"
                          className="w-full bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                        />
                      </div>
                      {sendTokens
                        .filter((t) =>
                          t.instrumentId
                            .toLowerCase()
                            .includes(tokenPickerQuery.trim().toLowerCase()),
                        )
                        .map((t) => {
                          const bal = t.isCC
                            ? typeof balance === "number"
                              ? balance
                              : sendBalances.cc
                            : parseFloat(
                                sendBalances.tokens[tokenBalanceKey(t)] ?? "0",
                              );
                          const tokenActive = t.isCC || isSendActive(t);
                          return (
                            <button
                              key={tokenBalanceKey(t)}
                              type="button"
                              disabled={!tokenActive}
                              onClick={() => {
                                if (!tokenActive) return;
                                setSelectedSendToken(t);
                                setTokenPickerOpen(false);
                                setTokenPickerQuery("");
                                setCcAmount("");
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left",
                                tokenActive
                                  ? "hover:bg-white/5"
                                  : "cursor-not-allowed opacity-50",
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <TokenLogo symbol={t.instrumentId} size="sm" />
                                <span className="font-medium text-slate-100">
                                  {displayName(t.instrumentId)}
                                </span>
                                {t.isCC && (
                                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                                    Instant
                                  </span>
                                )}
                                {!tokenActive && (
                                  <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                    Coming soon
                                  </span>
                                )}
                              </span>
                              <span className="text-xs tabular-nums text-slate-400">
                                {tokenActive ? bal.toFixed(4) : "—"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                  {selectedSendToken && (
                    <p className="text-xs text-slate-500">
                      Balance:{" "}
                      <span className="tabular-nums text-slate-300">
                        {selectedBalance.toFixed(6)}{" "}
                        {displayName(selectedSendToken.instrumentId)}
                      </span>
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <label
                    htmlFor="wallet-send-recipient"
                    className="text-sm font-medium text-slate-400"
                  >
                    Recipient
                  </label>
                  <textarea
                    id="wallet-send-recipient"
                    required
                    rows={2}
                    autoComplete="off"
                    value={recipientUsername}
                    onChange={(e) => setRecipientUsername(e.target.value)}
                    onBlur={() => {
                      const n = normalizeSendRecipientInput(recipientUsername);
                      if (n && n !== recipientUsername.trim()) setRecipientUsername(n);
                    }}
                    placeholder="@alice or alice::1220…"
                    disabled={sendState === "loading"}
                    className="w-full resize-none rounded-2xl border border-white/5 bg-white/5 px-4 py-3 font-mono text-sm font-medium text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="wallet-send-amount"
                      className="text-sm font-medium text-slate-400"
                    >
                      Amount
                    </label>
                    {selectedBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          // CC: kurangi fee. Non-CC: full balance (fee in CC, terpisah).
                          const max = selectedIsCC
                            ? Math.max(0, selectedBalance - feeCc)
                            : selectedBalance;
                          setCcAmount(max.toFixed(6));
                        }}
                        disabled={sendState === "loading"}
                        className="text-xs font-semibold text-[var(--primary)] hover:underline disabled:opacity-40"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                  <input
                    id="wallet-send-amount"
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    value={ccAmount}
                    onChange={(e) => setCcAmount(e.target.value)}
                    placeholder="e.g. 10"
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-bold tabular-nums text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                <div className="space-y-3">
                  <label
                    htmlFor="wallet-send-memo"
                    className="text-sm font-medium text-slate-400"
                  >
                    Memo{" "}
                    <span className="font-normal text-slate-500">(optional)</span>
                  </label>
                  <input
                    id="wallet-send-memo"
                    autoComplete="off"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder=""
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-medium text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                  />
                </div>

                {/* Fee notice */}
                <div className="flex justify-center px-6 py-4">
                  <p className="text-sm font-medium text-slate-400">
                    <span className="font-semibold text-slate-100">Platform Fee : {feeCc} CC</span>
                  </p>
                </div>

                {sendState === "error" && (
                  <div className="flex items-start gap-3 rounded-3xl border border-red-500/30 bg-red-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                    <p className="text-sm font-medium text-red-400">{sendMessage}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={sendState === "loading"}
                  className={cn(buttonVariants({ size: "sm" }), "mt-8 w-full sm:w-auto gap-2")}
                >
                  {sendState === "loading" ? (
                    <>
                      <LoadingSpinner size="sm" />
                      Sending…
                    </>
                  ) : (
                    "Send"
                  )}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={sendState === "loading"}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "w-full sm:w-auto",
                  )}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {/* ── WALLET PASSWORD GATE (Send) ── */}
      <WalletPasswordModal
        open={pwOpen}
        actionLabel="Send"
        error={pwError}
        busy={sendState === "loading"}
        onClose={closePasswordModal}
        onConfirm={confirmSendPassword}
      />

      <TransactionDetailModal
        open={successTransactionId !== null}
        transactionId={successTransactionId}
        title="Transfer sent"
        subtitle="Funds are on the way. Review your receipt below."
        partyId={partyId}
        onClose={closeSuccessReceipt}
      />


      {/* ── RECEIVE DIALOG ── */}
      {sheet === "receive" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="presentation"
        >
          <button
            type="button"
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={receiveTitleId}
            className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-8 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={receiveTitleId}
                  className="text-xl font-bold text-slate-100"
                >
                  Receive
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className={iconButtonClass("h-9 w-9 shrink-0 text-[var(--foreground)]")}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-8 flex justify-center rounded-3xl border border-white/5 bg-white p-6 dark:bg-zinc-950">
              <QRCodeSVG
                value={displayPartyId}
                size={200}
                level="M"
                marginSize={2}
                className="h-[200px] w-[200px]"
              />
            </div>

            <div className="mt-8">
              <CopyField label="Your Canton Party ID" value={displayPartyId} />
            </div>

            <button
              type="button"
              onClick={close}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "mt-8 w-full sm:w-auto",
              )}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* ── OFFERS MODAL ── */}
      <OffersModal
        open={sheet === "offers"}
        onClose={() => setSheet(null)}
        offers={offers}
        loading={offersLoading}
        error={offersError}
        setOffers={setOffers}
        onRefresh={() => {
          void refreshOffers();
          onBalanceRefresh?.();
        }}
        sentOffers={sentOffers}
        sentLoading={sentOffersLoading}
        sentError={sentOffersError}
        setSentOffers={setSentOffers}
        onSentRefresh={() => {
          void refreshSentOffers();
          onBalanceRefresh?.();
        }}
      />

      <SwapModal
        open={sheet === "swap"}
        onClose={() => setSheet(null)}
        balance={balance}
      />
    </>
  );
}
