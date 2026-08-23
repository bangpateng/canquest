"use client";

import { Check, Clock, Copy, Fingerprint, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { useTransactionStatus } from "@/lib/tx/transaction-status";

/**
 * Unified on-chain transaction status dialog (mockup `tx-status-modal`).
 * Mounted once in the platform shell; driven by the `useTransactionStatus`
 * store. Pure presentation — no fetch/network logic lives here.
 */
export function TransactionStatusModal() {
  const open = useTransactionStatus((s) => s.open);
  const stage = useTransactionStatus((s) => s.stage);
  const config = useTransactionStatus((s) => s.config);
  const dismiss = useTransactionStatus((s) => s.dismiss);
  const done = useTransactionStatus((s) => s.done);

  if (!open || !config) return null;

  const accentBg = config.accentBg ?? "bg-[var(--primary)]/15";
  const accentText = config.accentText ?? "text-canton";
  const fmtRound = (n: number) => "#" + n.toLocaleString("en-US");
  const meta = config.meta ?? [];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
    >
      <button className="modal-backdrop" aria-label="Close" onClick={dismiss} />
      <div className="relative z-10 my-auto max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] w-full max-w-[380px] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--card-solid)] shadow-[0_20px_44px_-24px_rgb(0_0_0/0.8)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
        <button
          className={iconButtonClass("absolute right-3 top-3 h-8 w-8")}
          onClick={dismiss}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 py-7 sm:px-7">
          {/* SIGN — authorize / prepare */}
          {stage === "sign" && (
            <div className="flex flex-col items-center text-center">
              <div
                className={cn(
                  "relative flex h-16 w-16 items-center justify-center rounded-2xl tx-pulse",
                  accentBg,
                  accentText,
                )}
              >
                <Fingerprint className="h-7 w-7" />
              </div>
              <p className="mt-4 text-base font-bold text-[var(--foreground)]">Preparing transaction</p>
              <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--muted-foreground)]">
                Authorizing with your Canton party…
              </p>
              <div className="mt-5 w-full rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3.5 text-left">
                <p className="text-2xl font-bold tabular-nums text-[var(--foreground)]">{config.amountText}</p>
                {config.subText ? (
                  <p className="mt-0.5 truncate text-xs font-medium text-[var(--muted-foreground)]">{config.subText}</p>
                ) : null}
              </div>
              <Button variant="secondary" size="sm" className="mt-5 w-full" onClick={dismiss}>
                Cancel
              </Button>
            </div>
          )}

          {/* BROADCAST — awaiting network */}
          {stage === "broadcast" && (
            <div className="flex flex-col items-center text-center">
              <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl", accentBg, accentText)}>
                <Loader2 className="h-7 w-7 spin" />
              </div>
              <p className="mt-4 text-base font-bold text-[var(--foreground)]">Broadcasting to Canton</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Waiting for network confirmation…</p>
              <div className="tx-progress-track mt-5 h-1.5 w-full rounded-full bg-[var(--muted)]">
                <div className="tx-progress-sweep rounded-full bg-gradient-to-r from-transparent via-[rgb(var(--canton-rgb))] to-transparent" />
              </div>
              <dl className="mt-5 w-full divide-y divide-[var(--border)] text-left">
                {config.round != null && (
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-xs text-[var(--muted-foreground)]">Round</dt>
                    <dd className="text-xs font-semibold tabular-nums text-[var(--foreground)]">{fmtRound(config.round)}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between py-2">
                  <dt className="text-xs text-[var(--muted-foreground)]">Status</dt>
                  <dd>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                      <Clock className="h-2.5 w-2.5" />
                      Pending
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* CONFIRMED — success */}
          {stage === "confirmed" && (
            <div className="flex flex-col items-center text-center tx-fade-up">
              <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-emerald-500/[0.13] text-emerald-600 tx-check-pop">
                <Check className="h-7 w-7" />
              </div>
              <p className="mt-4 text-base font-bold text-[var(--foreground)]">{config.title}</p>
              {config.subtitle ? (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{config.subtitle}</p>
              ) : null}
              <p className="mt-4 text-3xl font-bold tabular-nums text-[var(--foreground)]">{config.amountText}</p>
              {config.usdAmount ? (
                <TokenUsdValue
                  amount={config.usdAmount.amount}
                  token={config.usdAmount.token}
                  className="mt-1 text-sm font-medium text-[var(--muted-foreground)]"
                />
              ) : null}

              <dl className="mt-5 w-full divide-y divide-[var(--border)] text-left">
                {meta.map((m, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-2">
                    <dt className="shrink-0 text-xs text-[var(--muted-foreground)]">{m.label}</dt>
                    <dd
                      className={cn(
                        "min-w-0 max-w-[62%] truncate text-right text-xs font-semibold text-[var(--foreground)]",
                        m.mono && "font-mono",
                      )}
                    >
                      {m.value}
                    </dd>
                  </div>
                ))}
                {config.round != null && (
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-xs text-[var(--muted-foreground)]">Round</dt>
                    <dd className="text-xs font-semibold tabular-nums text-[var(--foreground)]">{fmtRound(config.round)}</dd>
                  </div>
                )}
                {config.txHash ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="shrink-0 text-xs text-[var(--muted-foreground)]">Tx hash</dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      {config.explorerUrl ? (
                        <a
                          href={config.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate font-mono text-xs font-semibold text-canton hover:underline"
                        >
                          {config.txHash}
                        </a>
                      ) : (
                        <span className="truncate font-mono text-xs font-semibold text-[var(--foreground)]">{config.txHash}</span>
                      )}
                      <button
                        className={iconButtonClass("h-6 w-6 shrink-0")}
                        onClick={() => {
                          if (config.txHash) void navigator.clipboard?.writeText(config.txHash);
                        }}
                        aria-label="Copy hash"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between py-2">
                  <dt className="text-xs text-[var(--muted-foreground)]">Status</dt>
                  <dd>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                      <Check className="h-2.5 w-2.5" />
                      Confirmed
                    </span>
                  </dd>
                </div>
              </dl>

              <Button className="mt-6 w-full" onClick={done}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
