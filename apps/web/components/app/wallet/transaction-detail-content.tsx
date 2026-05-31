"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import type { ReactNode } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";

import type { TransactionDetail } from "@/components/app/wallet/transaction-detail-view";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils/utils";

function shortTemplate(templateId: string): string {
  const parts = templateId.split(":");
  return parts.length >= 2 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : templateId;
}

function ReceiptField({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-slate-400">{label}</dt>
      <dd
        className={cn(
          "mt-2 min-w-0 text-base font-semibold text-slate-100 [overflow-wrap:anywhere]",
          mono && "font-mono text-sm font-medium",
        )}
      >
        {children}
      </dd>
    </div>
  );
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
  const t = usePlatformT();

  if (loading) {
    return (
      <div className={cn("flex justify-center", compact ? "py-12" : "py-24")}>
        <LoadingSpinner size="xl" tone="muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-white/5 bg-[var(--card)] p-8 text-center">
        <p className="text-sm font-medium text-slate-400">{error}</p>
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
          "w-full min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
          compact ? "p-6" : "p-8",
        )}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Transaction receipt
        </p>
        <h2
          className={cn(
            "mt-3 break-words font-bold text-slate-100",
            compact ? "text-xl" : "text-2xl",
          )}
        >
          {detail.description}
        </h2>
        <p
          className={cn(
            "mt-4 font-bold tabular-nums",
            compact ? "text-2xl" : "text-3xl",
            isOut ? "text-red-500" : "text-green-500",
          )}
        >
          {isOut ? "−" : "+"}
          {ccAmt.toFixed(4)} CC
        </p>
        <dl className="mt-6 space-y-5">
          <ReceiptField label="Type">{detail.type.replace(/_/g, " ")}</ReceiptField>
          {detail.counterparty ? (
            <ReceiptField label="Counterparty" mono>
              {detail.counterparty}
            </ReceiptField>
          ) : null}
          <ReceiptField label={t("transactions.when")}>
            {new Date(detail.createdAt).toLocaleString()}
          </ReceiptField>
          <ReceiptField label="On-chain">
            <span className="inline-flex items-center gap-2">
              {detail.onChainSettled ? (
                <>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="font-semibold">Settled</span>
                </>
              ) : (
                <span className="font-medium text-slate-400">Pending</span>
              )}
            </span>
          </ReceiptField>
          {detail.ledgerContractId ? (
            <ReceiptField label="Contract ID" mono>
              {detail.ledgerContractId}
            </ReceiptField>
          ) : null}
          {detail.cantonUpdateId ? (
            <ReceiptField label="Ledger update ID" mono>
              {detail.cantonUpdateId}
            </ReceiptField>
          ) : null}
        </dl>

        {detail.cantonScanUrl ? (
          <a
            href={detail.cantonScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/5 bg-[var(--muted)]/40 px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-[var(--muted)] sm:w-auto"
          >
            View on CantonScan
            <ExternalLink className="h-5 w-5" />
          </a>
        ) : null}
      </div>

      {detail.ledgerEvents.length > 0 ? (
        <div
          className={cn(
            "w-full min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
            compact ? "mt-5 p-6" : "mt-5 p-8",
          )}
        >
          <h3 className="text-base font-bold text-slate-100">On-chain events</h3>
          <p className="mt-2 text-sm font-medium text-slate-400">
            Contract lifecycle visible to your wallet.
          </p>
          <ul className="mt-4 divide-y divide-slate-800/80">
            {detail.ledgerEvents.map((ev, i) => (
              <li key={`${ev.contractId}-${i}`} className="py-3">
                <p className="text-base font-semibold capitalize text-slate-100">{ev.kind}</p>
                <p className="mt-1 font-mono text-sm font-medium text-slate-400">
                  {shortTemplate(ev.templateId)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : detail.ledgerFetchError ? (
        <p className="mt-4 text-sm font-medium text-slate-400">{detail.ledgerFetchError}</p>
      ) : null}
    </>
  );
}
