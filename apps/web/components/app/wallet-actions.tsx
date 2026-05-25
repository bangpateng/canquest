"use client";

import { CopyField } from "@/components/app/copy-field";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui-button-styles";
import {
  formatPartyIdForDisplay,
  normalizeSendRecipientInput,
} from "@/lib/canton-party-id";
import { cn } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Loader2, X, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";

type Sheet = null | "send" | "receive";
type SendState = "idle" | "loading" | "success" | "error";

interface WalletActionsProps {
  partyId: string;
  onBalanceRefresh?: () => void;
}

export function WalletActions({ partyId, onBalanceRefresh }: WalletActionsProps) {
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

  const close = useCallback(() => {
    setSheet(null);
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
      };

      if (
        !res.ok ||
        data.success === false ||
        data.accepted === false
      ) {
        setSendState("error");
        setSendMessage(data.message ?? data.error ?? "Transfer failed. Please try again.");
        return;
      }

      setSendState("success");
      setSendMessage(
        data.message ??
          `Sent ${amount} CC` +
            (data.feeCollected && data.fee
              ? ` (fee ${data.fee} CC, total ${data.totalDeducted ?? amount + data.fee} CC)`
              : ""),
      );
      onBalanceRefresh?.();
    } catch {
      setSendState("error");
      setSendMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <>
      <div className="grid w-full min-w-0 grid-cols-2 gap-3">
        <button
          type="button"
          onClick={openSend}
          className={cn(buttonVariants({ size: "sm" }), "w-full justify-center gap-2")}
        >
          <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
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
          <ArrowDownLeft className="h-4 w-4 shrink-0" aria-hidden />
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
            className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id={sendTitleId}
                  className="type-section-title text-[var(--foreground)]"
                >
                  Send
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Send Canton Coin by Party ID.
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

            {sendState === "success" ? (
              <div className="mt-6 flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="text-sm font-medium text-[var(--foreground)]">{sendMessage}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  The CC will arrive in the recipient&apos;s wallet shortly.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className={cn(buttonVariants({ size: "sm" }), "mt-2")}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submitSend} className="mt-6 space-y-4">
                                <div className="space-y-2">
                  <label
                    htmlFor="wallet-send-recipient"
                    className="text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Recipient
                    <span className="ml-1 font-normal text-[var(--muted-foreground)]/70">
                      (@username or Party ID)
                    </span>
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
                    className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/25 disabled:opacity-50"
                  />
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Enter <strong>@username</strong> for CanQuest users, or paste the full
                    <strong> Party ID</strong> (e.g. <code>alice::1220…</code>) for any Canton party.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="wallet-send-amount"
                    className="text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Amount (CC)
                  </label>
                  <input
                    id="wallet-send-amount"
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    value={ccAmount}
                    onChange={(e) => setCcAmount(e.target.value)}
                    placeholder="e.g. 10"
                    disabled={sendState === "loading"}
                    className="type-display w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm tabular-nums text-[var(--foreground)] outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/25 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="wallet-send-memo"
                    className="text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Memo{" "}
                    <span className="font-normal text-[var(--muted-foreground)]/70">(optional)</span>
                  </label>
                  <input
                    id="wallet-send-memo"
                    autoComplete="off"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder=""
                    disabled={sendState === "loading"}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm text-[var(--foreground)] outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/25 disabled:opacity-50"
                  />
                </div>

                {/* Fee notice — value from env TRANSACTION_FEE_CC */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2">
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    <span className="font-medium text-[var(--foreground)]">Platform fee: {feeCc} CC</span>
                    {ccAmount && parseFloat(ccAmount) > 0 && (
                      <span className="ml-1 font-medium text-canton">
                        · Total: {(parseFloat(ccAmount) + feeCc).toFixed(2)} CC
                      </span>
                    )}
                  </p>
                </div>

                {sendState === "error" && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <p className="text-xs text-red-500">{sendMessage}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={sendState === "loading"}
                    className={cn(buttonVariants({ size: "sm" }), "min-w-[7rem] gap-2")}
                  >
                    {sendState === "loading" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      "Send CC"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={sendState === "loading"}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

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
            className="relative z-10 my-auto w-full max-h-[min(90vh,90dvh)] max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id={receiveTitleId}
                  className="type-section-title text-[var(--foreground)]"
                >
                  Receive CC
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

            <div className="mt-6 flex justify-center rounded-2xl border border-[var(--border)] bg-white p-4 dark:bg-zinc-950">
              <QRCodeSVG
                value={displayPartyId}
                size={200}
                level="M"
                marginSize={2}
                className="h-[200px] w-[200px]"
              />
            </div>

            <div className="mt-6">
              <CopyField label="Your Canton Party ID" value={displayPartyId} />
            </div>

            <button
              type="button"
              onClick={close}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "mt-6 w-full sm:w-auto",
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
