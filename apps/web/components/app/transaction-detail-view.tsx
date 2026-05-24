"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type TransactionDetail = {
  id: string;
  type: string;
  amountMicroCc: string;
  description: string;
  referenceId: string | null;
  counterparty: string | null;
  ledgerContractId: string | null;
  cantonUpdateId: string | null;
  settledAt: string | null;
  createdAt: string;
  cantonPartyId: string | null;
  cantonScanUrl: string | null;
  onChainSettled: boolean;
  ledgerEvents: Array<{
    kind: "created" | "archived";
    contractId: string;
    templateId: string;
  }>;
  ledgerFetchError: string | null;
};

type TransactionDetailViewProps = {
  transactionId: string;
};

function shortTemplate(templateId: string): string {
  const parts = templateId.split(":");
  return parts.length >= 2 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : templateId;
}

export function TransactionDetailView({ transactionId }: TransactionDetailViewProps) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/party/transactions/${encodeURIComponent(transactionId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "Transaction not found." : "Could not load transaction.");
        setDetail(null);
        return;
      }
      setDetail((await res.json()) as TransactionDetail);
    } catch {
      setError("Could not load transaction.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ccAmt = detail
    ? Math.abs(Number(detail.amountMicroCc)) / 1_000_000
    : 0;
  const isOut = detail?.type === "TRANSFER_OUT";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/transactions"
        className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to transactions
      </Link>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        </div>
      ) : detail ? (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Transaction receipt
            </p>
            <h1 className="type-page-title mt-2">{detail.description}</h1>
            <p
              className={cn(
                "type-display mt-4 text-2xl font-semibold tabular-nums",
                isOut ? "text-red-500" : "text-green-500",
              )}
            >
              {isOut ? "−" : "+"}
              {ccAmt.toFixed(4)} CC
            </p>
            <dl className="mt-6 space-y-3 text-sm">
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
                    <span className="text-[var(--muted-foreground)]">Pending / off-chain only</span>
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
                className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--muted)]"
              >
                View on CantonScan
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>

          {detail.ledgerEvents.length > 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
              <h2 className="text-sm font-semibold">On-chain events (your party)</h2>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Contract lifecycle visible to your wallet. Business data stays private on Canton.
              </p>
              <ul className="mt-4 divide-y divide-[var(--border)]">
                {detail.ledgerEvents.map((ev, i) => (
                  <li key={`${ev.contractId}-${i}`} className="py-3 text-sm">
                    <p className="font-medium capitalize">{ev.kind}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                      {shortTemplate(ev.templateId)}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-[var(--muted-foreground)]">
                      {ev.contractId}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : detail.ledgerFetchError ? (
            <p className="text-xs text-[var(--muted-foreground)]">{detail.ledgerFetchError}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
