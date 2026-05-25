"use client";

import {
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import type { TransactionDetail } from "@/components/app/transaction-detail-view";
import { cn } from "@/lib/utils";

function shortTemplate(templateId: string): string {
  const parts = templateId.split(":");
  return parts.length >= 2 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : templateId;
}

type TransactionDetailContentProps = {
  detail: TransactionDetail | null;
  loading: boolean;
  error: string | null;
  /** Compact layout for modal after send */
  compact?: boolean;
};

export function TransactionDetailContent({
  detail,
  loading,
  error,
  compact = false,
}: TransactionDetailContentProps) {
  if (loading) {
    return (
      <div className={cn("flex justify-center", compact ? "py-10" : "py-20")}>
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
      </div>
    );
  }

  if (!detail) return null;

  const ccAmt = Math.abs(Number(detail.amountMicroCc)) / 1_000_000;
  const isOut = detail.type === "TRANSFER_OUT";

  return (
    <>
      <div
        className={cn(
          "rounded-2xl border border-[var(--border)] bg-[var(--card)]",
          compact ? "p-5" : "p-6",
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Transaction receipt
        </p>
        <h2 className={cn("mt-2 font-semibold text-[var(--foreground)]", compact ? "text-lg" : "type-page-title")}>
          {detail.description}
        </h2>
        <p
          className={cn(
            "mt-3 font-semibold tabular-nums",
            compact ? "text-xl" : "type-display text-2xl",
            isOut ? "text-red-500" : "text-green-500",
          )}
        >
          {isOut ? "−" : "+"}
          {ccAmt.toFixed(4)} CC
        </p>
        <dl className="mt-5 space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted-foreground)]">Type</dt>
            <dd className="font-medium">{detail.type.replace(/_/g, " ")}</dd>
          </div>
          {detail.counterparty ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted-foreground)]">Counterparty</dt>
              <dd className="truncate font-mono text-xs">{detail.counterparty}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted-foreground)]">When</dt>
            <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted-foreground)]">On-chain</dt>
            <dd className="flex items-center gap-1.5">
              {detail.onChainSettled ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                  <span>Settled</span>
                </>
              ) : (
                <span className="text-[var(--muted-foreground)]">Pending</span>
              )}
            </dd>
          </div>
          {detail.ledgerContractId ? (
            <div className="flex flex-col gap-1">
              <dt className="text-[var(--muted-foreground)]">Contract ID</dt>
              <dd className="break-all font-mono text-xs">{detail.ledgerContractId}</dd>
            </div>
          ) : null}
          {detail.cantonUpdateId ? (
            <div className="flex flex-col gap-1">
              <dt className="text-[var(--muted-foreground)]">Ledger update ID</dt>
              <dd className="break-all font-mono text-xs">{detail.cantonUpdateId}</dd>
            </div>
          ) : null}
        </dl>

        {detail.cantonScanUrl ? (
          <a
            href={detail.cantonScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--muted)] sm:w-auto"
          >
            View on CantonScan
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      {detail.ledgerEvents.length > 0 ? (
        <div
          className={cn(
            "rounded-2xl border border-[var(--border)] bg-[var(--card)]",
            compact ? "mt-4 p-4" : "mt-6 p-6",
          )}
        >
          <h3 className="text-sm font-semibold">On-chain events</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Contract lifecycle visible to your wallet.
          </p>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {detail.ledgerEvents.map((ev, i) => (
              <li key={`${ev.contractId}-${i}`} className="py-2.5 text-sm">
                <p className="font-medium capitalize">{ev.kind}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--muted-foreground)]">
                  {shortTemplate(ev.templateId)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : detail.ledgerFetchError ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">{detail.ledgerFetchError}</p>
      ) : null}
    </>
  );
}
