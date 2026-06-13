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
import { ArrowDownLeft, ArrowUpRight, X, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

type Sheet = null | "send" | "receive";
type SendState = "idle" | "loading" | "success" | "error";

interface WalletActionsProps {
  partyId: string;
  balance?: number | null;
  onBalanceRefresh?: () => void;
}

export function WalletActions({ partyId, balance, onBalanceRefresh }: WalletActionsProps) {
  const displayPartyId = formatPartyIdForDisplay(partyId);
  const sendTitleId = useId();
  const receiveTitleId = useId();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [feeCc, setFeeCc] = useState(5);

  // Fetch fee config from backend env so UI stays in sync with .env
  useEffect(() => {
    fetch("/api/party/fee-config", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { feeCc?: number } | null) => { if (d?.feeCc !== undefined) setFeeCc(d.feeCc); })
      .catch(() => {});
  }, []);

  // Send form state
  const [recipientUsername, setRecipientUsername] = useState("");
  const [ccAmount, setCcAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendMessage, setSendMessage] = useState("");
  const [successTransactionId, setSuccessTransactionId] = useState<string | null>(null);

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
    setSheet("send");
  }

  async function submitSend(e: React.FormEvent) {
    e.preventDefault();
    const recipient = normalizeSendRecipientInput(recipientUsername);
    const amount = parseFloat(ccAmount.trim());
    if (!recipient || !amount || amount <= 0) return;

    setSendState("loading");
    setSendMessage("");

    try {
      const res = await fetch("/api/party/send-cc", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientUsername: recipient,
          amount,
          memo: memo.trim() || undefined,
        }),
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
        transactionId?: string;
        to?: string;
      };

      // Error hanya jika HTTP error ATAU success=false
      // accepted=false + offerPending=true = offer berhasil dibuat, receiver perlu accept manual (BUKAN error)
      if (!res.ok || data.success === false) {
        setSendState("error");
        setSendMessage(data.message ?? data.error ?? "Transfer failed. Please try again.");
        return;
      }

      setSheet(null);
      setSendState("idle");
      if (typeof data.transactionId === "string" && data.transactionId) {
        setSuccessTransactionId(data.transactionId);
      } else if (data.offerPending) {
        // Offer berhasil dibuat tapi receiver harus accept manual (external party / different participant)
        setSendState("success");
        setSendMessage(
          data.message ??
            `Transfer offer sent for ${amount} CC. The recipient must accept it from their wallet.`,
        );
        setSheet("send");
      } else {
        setSendState("success");
        setSendMessage(
          data.message ??
            `Sent ${amount} CC` +
              (data.feeCollected && data.fee
                ? ` (fee ${data.fee} CC, total ${data.totalDeducted ?? amount + data.fee} CC)`
                : ""),
        );
        setSheet("send");
      }
      onBalanceRefresh?.();
    } catch {
      setSendState("error");
      setSendMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <>
      <div className="grid w-full min-w-0 grid-cols-2 gap-4">
        <button
          type="button"
          onClick={openSend}
          className={cn(buttonVariants({ size: "sm" }), "w-full justify-center gap-2")}
        >
          <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden />
          Send CC
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
      </div>

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
                    {balance != null && balance > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const max = Math.max(0, balance - feeCc);
                          setCcAmount(max.toFixed(4));
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
                    <span className="font-semibold text-slate-100">Fee Withdraw : {feeCc} CC</span>
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

      <TransactionDetailModal
        open={successTransactionId !== null}
        transactionId={successTransactionId}
        title="Transfer sent"
        subtitle="Funds are on the way. Review your receipt below."
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
    </>
  );
}
