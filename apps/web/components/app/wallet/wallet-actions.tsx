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
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { OffersModal, useOffers, useSentOffers } from "@/components/app/wallet/offers-section";
import { SwapModal } from "@/components/app/wallet/swap-modal";
import { TxReviewModal } from "@/components/app/wallet/tx-review-modal";
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
  Zap,
  Share2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
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
import { useFeeConfig } from "@/lib/hooks/use-fee-config";
import { useMe } from "@/lib/hooks/use-me";
import { ModalPortal } from "@/lib/ui/modal-portal";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { SignPassphraseModal } from "@/components/app/wallet/sign-passphrase-modal";
import {
  SignatureRequestModal,
} from "@/components/app/wallet/signature-request-modal";
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

  // Fee config (TRANSACTION_FEE_CC dari env backend) via shared react-query
  // hook — ter-dedup dengan SettingsPreapprovalPanel yang baca endpoint sama.
  const { data: feeConfig } = useFeeConfig();
  const feeCc = feeConfig?.feeCc ?? 5;

  // Unified on-chain transaction status modal (Sign → Broadcast → Confirmed).
  // Presentation layer only — driven around the existing fetch in submitSend.
  const tx = useTransactionStatus();

  // M3b: user external (non-custodial) → transaksi CC di-sign di browser.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";

  // Prompt passphrase deferred — dipakai sign-relay saat dompet terkunci.
  const [passPrompt, setPassPrompt] = useState<{
    description: string;
    resolve: (pass: string) => void;
    reject: () => void;
  } | null>(null);
  const openPassphrasePrompt = useCallback((description: string) => {
    return new Promise<string>((resolve, reject) => {
      setPassPrompt({ description, resolve, reject });
    });
  }, []);

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
  // (Hanya tampilkan token yang dikenal — bukan semua token OneSwap random).
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

  // ── Alur 2-langkah: form Send → modal "Confirm transaction" → eksekusi.
  // confirmOpen membuka modal review. Pada Confirm, modal panggil submitSend.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Langkah SIGN (mockup Signature Request): user external menekan satu
  // tombol "Sign & Send" — dompet auto-unlock via device key, tanpa passphrase.
  const [signOpen, setSignOpen] = useState(false);

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

  // Submit dari FORM Send: validasi dasar, lalu buka modal konfirmasi (2-langkah).
  // Eksekusi sebenarnya (fetch) baru jalan saat user klik "Confirm".
  function onSendSubmit(e: React.FormEvent) {
    e.preventDefault();
    const recipient = normalizeSendRecipientInput(recipientUsername);
    const amount = parseFloat(ccAmount.trim());
    if (!recipient || !amount || amount <= 0) return;
    if (!selectedSendToken) return;
    setSendState("idle");
    setSendMessage("");
    setConfirmOpen(true);
  }

  // Tutup modal konfirmasi (Cancel / backdrop). Reset state tanpa eksekusi.
  function closeConfirm() {
    setConfirmOpen(false);
    setSendState("idle");
    setSendMessage("");
  }

  async function submitSend(e: React.FormEvent) {
    e.preventDefault();
    const recipient = normalizeSendRecipientInput(recipientUsername);
    const amount = parseFloat(ccAmount.trim());
    if (!recipient || !amount || amount <= 0) return;
    if (!selectedSendToken) return;

    setSendState("loading");
    setSendMessage("");

    // Open the unified status modal at Sign, then advance to Broadcast while
    // the real fetch is in flight. On resolve we call succeed() (or dismiss()
    // on error). The fetch itself is unchanged.
    const tokenLabel = displayName(selectedSendToken.instrumentId);
    const recipientDisplay = formatPartyIdForDisplay(recipient);
    // Modal status hanya SETELAH sign.
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
    };
    if (!isCC) {
      payload.instrumentId = selectedSendToken.instrumentId;
      payload.instrumentAdmin = selectedSendToken.instrumentAdmin;
    }

    // ── M3b: user EXTERNAL → tanda tangan di browser via sign relay ──────
    // Modal status berhenti di tahap 'sign' (menunggu passphrase bila dompet
    // terkunci); broadcast() hanya setelah signature diterima.
    if (isExternalWallet) {
      try {
        await signRelayTransaction(
          isCC ? "send_cc" : "send_token",
          {
            to: recipient,
            amount,
            memo: memo.trim() || undefined,
            clientNonce: nonce,
            ...(!isCC
              ? {
                  instrumentId: selectedSendToken.instrumentId,
                  instrumentAdmin: selectedSendToken.instrumentAdmin,
                }
              : {}),
          },
          {
            onWalletLocked: () =>
              openPassphrasePrompt(
                `Send ${amount} ${tokenLabel} to ${recipientDisplay}`,
              ),
          },
        );
      } catch (err) {
        tx.fail(
          err instanceof Error
            ? err.message
            : "Transfer failed. Please try again.",
        );
        setSendState("error");
        setSendMessage(
          err instanceof Error
            ? err.message
            : "Transfer failed. Please try again.",
        );
        setConfirmOpen(false);
        return;
      }
      tx.startBroadcast({
        amountText: `${amount} ${tokenLabel}`,
        subText: recipientDisplay,
        title: "Transfer sent",
        subtitle: "Funds are on the way.",
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
      });
      setConfirmOpen(false);
      // Sukses sudah ditampilkan modal status (✓ Transfer sent) — tutup form
      // Send sepenuhnya, tanpa pesan sukses ganda di form.
      setSheet(null);
      setSendState("idle");
      setSendMessage("");
      onBalanceRefresh?.();
      void invalidateWalletTokens();
      tx.succeed({
        amountText: `${amount} ${tokenLabel}`,
        title: "Transfer sent",
        subtitle: "Signed with your key.",
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
        meta: [
          { label: "Amount", value: `${amount} ${tokenLabel}` },
          { label: "Recipient", value: recipientDisplay, mono: true },
          { label: "Network", value: "Canton" },
        ],
      });
      return;
    }

    tx.startBroadcast({
      amountText: `${amount} ${tokenLabel}`,
      subText: recipientDisplay,
      title: "Transfer sent",
      subtitle: "Funds are on the way.",
      accentBg: "bg-[var(--primary)]/15",
      accentText: "text-canton",
    });

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
        tx.fail(
          data.message ?? data.error ?? "Transfer failed. Please try again.",
        );
        setSendState("error");
        setSendMessage(data.message ?? data.error ?? "Transfer failed. Please try again.");
        setConfirmOpen(false);
        return;
      }

      // Sukses → tutup modal konfirmasi & form.
      setConfirmOpen(false);
      setSheet(null);
      setSendState("idle");
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

      // Advance the unified status modal to Confirmed (overlay above the
      // receipt/success UI). Done → reveals whatever was opened below.
      const isOffer = Boolean(data.offerPending);
      tx.succeed({
        amountText: `${amount} ${tokenLabel}`,
        title: isOffer ? "Offer sent" : "Transfer sent",
        subtitle: isOffer ? "Recipient must accept to receive." : "Funds are on the way.",
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
        meta: [
          { label: "Amount", value: `${amount} ${tokenLabel}` },
          ...(selectedIsCC && data.fee ? [{ label: "Fee", value: `${data.fee} CC` }] : []),
          { label: "Recipient", value: recipientDisplay, mono: true },
          { label: "Network", value: "Canton" },
        ],
      });
    } catch {
      tx.fail("Network error. Check your connection and try again.");
      setSendState("error");
      setSendMessage("Network error. Check your connection and try again.");
      setConfirmOpen(false);
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
              "border-canton-muted text-canton hover:border-canton-muted hover:bg-canton-subtle",
          )}
        >
          <Inbox className="h-5 w-5 shrink-0" aria-hidden />
          Offers
          {offersCount > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-bold text-[var(--primary-foreground)] shadow ring-2 ring-[var(--card)]"
              aria-hidden
            >
              {offersCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSheet("swap")}
          title="Swap"
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
              "border-canton-muted text-canton hover:border-canton-muted hover:bg-canton-subtle",
          )}
        >
          <Lock className="h-5 w-5 shrink-0" aria-hidden />
          Lock
          {lockedCc > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-bold text-[var(--primary-foreground)] shadow ring-2 ring-[var(--card)]"
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
        <ModalPortal>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="presentation"
        >
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={sendTitleId}
            className="relative z-10 my-auto w-full max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={sendTitleId}
                  className="text-xl font-bold text-[var(--foreground)]"
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
              <form onSubmit={onSendSubmit} className="mt-8 space-y-6">
                {/* ── TOKEN SELECTOR (CC + USDCx + token aktif lainnya) ── */}
                <div className="relative space-y-2">
                  <label className="text-sm font-medium text-[var(--muted-foreground)]">Token</label>
                  <button
                    type="button"
                    onClick={() => setTokenPickerOpen((v) => !v)}
                    disabled={sendState === "loading"}
                    className="flex w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-left disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      {selectedSendToken ? (
                        <>
                          <TokenLogo symbol={selectedSendToken.instrumentId} size="sm" />
                          <span className="font-bold text-[var(--foreground)]">
                            {displayName(selectedSendToken.instrumentId)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">Select token</span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
                  </button>

                  {tokenPickerOpen && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl">
                      <div className="mb-2 flex items-center gap-2 px-2">
                        <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                        <input
                          autoFocus
                          value={tokenPickerQuery}
                          onChange={(e) => setTokenPickerQuery(e.target.value)}
                          placeholder="Search token"
                          className="w-full bg-transparent py-1 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
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
                                  ? "hover:bg-[var(--muted)]"
                                  : "cursor-not-allowed opacity-50",
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <TokenLogo symbol={t.instrumentId} size="sm" />
                                <span className="font-medium text-[var(--foreground)]">
                                  {displayName(t.instrumentId)}
                                </span>
                                {!tokenActive && (
                                  <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                                    Coming soon
                                  </span>
                                )}
                              </span>
                              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                                {tokenActive ? bal.toFixed(4) : "—"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="wallet-send-amount"
                      className="text-sm font-medium text-[var(--muted-foreground)]"
                    >
                      Amount
                    </label>
                    {selectedSendToken && (
                      <p className="tabular-nums text-xs text-[var(--muted-foreground)]">
                        {selectedBalance.toFixed(6)}{" "}
                        {displayName(selectedSendToken.instrumentId)}
                      </p>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="wallet-send-amount"
                      required
                      inputMode="decimal"
                      autoComplete="off"
                      value={ccAmount}
                      onChange={(e) => setCcAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={sendState === "loading"}
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--muted)] py-3 pl-4 pr-16 text-base font-bold tabular-nums text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--canton-rgb)/0.40)] disabled:opacity-50"
                    />
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
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "absolute right-2 top-1/2 h-auto -translate-y-1/2 px-2.5 py-1 text-xs",
                        )}
                      >
                        MAX
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="wallet-send-recipient"
                      className="text-sm font-medium text-[var(--muted-foreground)]"
                    >
                      Recipient
                    </label>
                    {normalizeSendRecipientInput(recipientUsername) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-canton">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                      </span>
                    ) : null}
                  </div>
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
                    placeholder="Recipient wallet address"
                    disabled={sendState === "loading"}
                    className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3 font-mono text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--canton-rgb)/0.40)] disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="wallet-send-memo"
                    className="text-sm font-medium text-[var(--muted-foreground)]"
                  >
                    Memo{" "}
                    <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
                  </label>
                  <input
                    id="wallet-send-memo"
                    autoComplete="off"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Add a note"
                    disabled={sendState === "loading"}
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-base font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--canton-rgb)/0.40)] disabled:opacity-50"
                  />
                </div>

                {sendState === "error" && (
                  <div className="flex items-start gap-3 rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--danger)]" />
                    <p className="text-sm font-medium text-[var(--danger)]">{sendMessage}</p>
                  </div>
                )}

                {selectedIsCC && (
                  <div className="flex items-center justify-between rounded-2xl bg-[var(--muted)]/60 px-4 py-2.5 text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                      <Zap className="h-3.5 w-3.5" />
                      Network fee
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--foreground)]">
                      ≈ {feeCc} CC · Canton
                    </span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={close}
                    disabled={sendState === "loading"}
                    className="flex-1 rounded-xl bg-[var(--muted)] px-4 py-4 text-base font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]/60 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sendState === "loading"}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#a3e635] to-[#4ade80] px-4 py-4 text-base font-semibold text-[#064e3b] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                </div>
              </form>
            )}
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {/* ── REVIEW MODAL (langkah 2 — Input → Review → Sign → Broadcast → Done) ── */}
      <ModalPortal>
      <TxReviewModal
        open={confirmOpen}
        amountText={`${ccAmount || "0"} ${selectedSendToken ? displayName(selectedSendToken.instrumentId) : ""}`}
        rows={[
          {
            label: "Recipient",
            value: formatPartyIdForDisplay(normalizeSendRecipientInput(recipientUsername)),
            mono: true,
          },
          { label: "Memo", value: memo.trim() || "—" },
          { label: "Network", value: "Canton" },
          ...(selectedIsCC
            ? [{ label: "Platform fee", value: `≈ ${feeCc} CC` }]
            : []),
        ]}
        confirmLabel="Confirm & Sign"
        onClose={closeConfirm}
        onConfirm={() => {
          // Tutup review DULU — langkah berikutnya ambil alih (satu modal
          // terlihat pada satu waktu).
          setConfirmOpen(false);
          // User external: satu langkah lagi — Signature Request (button-only).
          if (isExternalWallet) {
            setSignOpen(true);
            return;
          }
          void submitSend({ preventDefault: () => {} } as React.FormEvent);
        }}
      />
      </ModalPortal>

      {/* Langkah SIGN — Signature Request ringkas (tanpa passphrase). */}
      <ModalPortal>
      <SignatureRequestModal
        open={signOpen}
        amountText={`${ccAmount || "0"} ${selectedSendToken ? displayName(selectedSendToken.instrumentId) : ""}`}
        subText={`to ${formatPartyIdForDisplay(normalizeSendRecipientInput(recipientUsername))}`}
        busy={sendState === "loading"}
        onSign={() => {
          void submitSend({ preventDefault: () => {} } as React.FormEvent).finally(
            () => setSignOpen(false),
          );
        }}
        onReject={() => setSignOpen(false)}
      />
      </ModalPortal>

      <ModalPortal>
      <TransactionDetailModal
        open={successTransactionId !== null}
        transactionId={successTransactionId}
        title="Transfer sent"
        subtitle="Funds are on the way. Review your receipt below."
        partyId={partyId}
        onClose={closeSuccessReceipt}
      />
      </ModalPortal>

      {/* M3b: prompt passphrase saat dompet terkunci (sign transaksi external). */}
      <ModalPortal>
      <SignPassphraseModal
        open={!!passPrompt}
        description={passPrompt?.description}
        onSubmit={(pass) => {
          passPrompt?.resolve(pass);
          setPassPrompt(null);
        }}
        onCancel={() => {
          passPrompt?.reject();
          setPassPrompt(null);
        }}
      />
      </ModalPortal>


      {/* ── RECEIVE DIALOG ── */}
      {sheet === "receive" ? (
        <ModalPortal>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="presentation"
        >
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={receiveTitleId}
            className="relative z-10 my-auto w-full max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={receiveTitleId}
                  className="text-xl font-bold text-[var(--foreground)]"
                >
                  Receive
                </h2>
                <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                  Only send assets on Canton to this address.
                </p>
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

            <div className="mt-6">
              <CopyField label="Your Canton Party ID" value={displayPartyId} />
            </div>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)]">
              <span className="h-1.5 w-1.5 rounded-full bg-canton" />
              Canton Network
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sending unsupported assets or wrong-network tokens to this address may result in permanent loss.
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const shareData = {
                    title: "My Canton Party ID",
                    text: displayPartyId,
                  };
                  if (typeof navigator !== "undefined" && navigator.share) {
                    void navigator.share(shareData).catch(() => {});
                  } else if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(displayPartyId);
                  }
                }}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "flex-1 gap-2",
                )}
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>
              <button
                type="button"
                onClick={close}
                className={cn(buttonVariants({ size: "sm" }), "flex-1")}
              >
                Done
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {/* ── OFFERS MODAL ── */}
      <ModalPortal>
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
      </ModalPortal>

      <SwapModal
        open={sheet === "swap"}
        onClose={() => setSheet(null)}
        balance={balance}
      />
    </>
  );
}
