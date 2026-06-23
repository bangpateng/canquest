"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, Lock, LockOpen, ShieldCheck } from "lucide-react";

import type { TransactionDetail } from "@/components/app/wallet/transaction-detail-view";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

function shortTemplate(templateId: string): string {
  const parts = templateId.split(":");
  return parts.length >= 2 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : templateId;
}

/** True when two Canton party IDs refer to the same wallet. */
function partyIdsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}

/** Format a microCC string to a CC number. */
function microCcToCc(micro: string | null | undefined): number {
  if (!micro) return 0;
  return Math.abs(Number(micro)) / 1_000_000;
}

/** Truncate a long id/address for compact display. */
function truncateMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Render an address; if it is the caller's own party, append a muted "(You)" label. */
function AddressValue({
  address,
  partyId,
}: {
  address: string | null | undefined;
  partyId: string | null | undefined;
}) {
  if (!address) return <span className="text-slate-400">{"\u2014"}</span>;
  const isYou = partyIdsEqual(address, partyId);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{address}</span>
      {isYou ? (
        <span className="text-xs font-medium text-slate-500">(You)</span>
      ) : null}
    </span>
  );
}

/** Small inline copy-to-clipboard button. */
function InlineCopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={iconButtonClass("h-7 w-7 shrink-0 text-slate-100")}
      aria-label={label}
    >
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
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
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-sm font-medium text-slate-400">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm font-semibold text-slate-100 [overflow-wrap:anywhere]",
          mono && "font-mono",
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
  /** Caller's Canton party ID — used to highlight which address is "You". */
  partyId?: string | null;
  /** Compact layout for modal after send */
  compact?: boolean;
};

const LIGHTHOUSE_TX_BASE = "https://lighthouse.xyz/transfers";

export function TransactionDetailContent({
  detail,
  loading,
  error,
  partyId = null,
  compact = false,
}: TransactionDetailContentProps) {
  const t = usePlatformT();

  if (loading) {
    return (
      <div className={cn("flex justify-center", compact ? "py-10" : "py-24")}>
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

  const ccAmt = microCcToCc(detail.amountMicroCc);
  const isOut = detail.type === "TRANSFER_OUT";
  const isIn = detail.type === "TRANSFER_IN";
  const isLock = detail.type === "CC_LOCK";
  const isUnlock = detail.type === "CC_UNLOCK";
  const isTransfer = isOut || isIn;
  // Lock/unlock = non-custodial: TIDAK punya counterparty, jangan tampilkan From/To.
  const isLockLike = isLock || isUnlock;
  // Debit (negatif): TRANSFER_OUT & CC_LOCK. Kredit (positif): sisanya termasuk CC_UNLOCK.
  const isDebit = isOut || isLock;

  // User's own wallet address — prefer the detail's stored party, fall back to prop.
  const ownAddress = detail.cantonPartyId ?? partyId ?? null;

  // From / To use the REAL sender/receiver addresses. We only tag the one that
  // matches the user's party as "(You)" — never default both to the user.
  const fromAddress =
    detail.senderAddress ?? (isOut ? ownAddress : detail.counterparty) ?? null;
  const toAddress =
    detail.receiverAddress ?? (isIn ? ownAddress : detail.counterparty) ?? null;

  // Tx ID for copy/explorer — prefer Lighthouse event id, fall back to update/contract id.
  const txId =
    detail.eventId ?? detail.cantonUpdateId ?? detail.ledgerContractId ?? detail.id;
  const lighthouseUrl = detail.eventId
    ? `${LIGHTHOUSE_TX_BASE}/${encodeURIComponent(detail.eventId)}`
    : null;

  const feeCc = microCcToCc(detail.networkFeeMicroCc);
  const platformFeeCc = microCcToCc(detail.platformFeeMicroCc);
  const roundDisplay =
    detail.round != null && detail.round !== "" ? String(detail.round) : null;
  const usdDisplay =
    typeof detail.usdEstimate === "number" && Number.isFinite(detail.usdEstimate)
      ? detail.usdEstimate
      : null;

  // For on-chain transfers the fields already show everything — hide the
  // separate "On-chain events" block so the modal fits without scrolling.
  const showLedgerEvents = !isTransfer && detail.ledgerEvents.length > 0;

  return (
    <>
      <div
        className={cn(
          "w-full min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
          compact ? "p-5" : "p-8",
        )}
      >
        {/* Centered amount hero */}
        <div className="flex flex-col items-center text-center">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full",
              isLock
                ? "bg-amber-500/15 text-amber-500"
                : isUnlock || isIn
                  ? "bg-green-500/15 text-green-500"
                  : "bg-red-500/15 text-red-500",
            )}
            aria-hidden
          >
            {isLock ? (
              <Lock className="h-5 w-5" />
            ) : isUnlock ? (
              <LockOpen className="h-5 w-5" />
            ) : isIn ? (
              <ArrowDownLeft className="h-5 w-5" />
            ) : (
              <ArrowUpRight className="h-5 w-5" />
            )}
          </span>
          <p
            className={cn(
              "mt-3 font-bold tabular-nums",
              compact ? "text-3xl" : "text-4xl",
              isLock
                ? "text-amber-500"
                : isOut
                  ? "text-red-500"
                  : "text-green-500",
            )}
          >
            {isDebit ? "−" : "+"}
            {ccAmt.toFixed(4)} CC
          </p>
          {usdDisplay != null ? (
            <p className="mt-0.5 text-sm font-medium text-slate-400 tabular-nums">
              ≈ ${usdDisplay.toFixed(2)} USD
            </p>
          ) : null}
        </div>

        <dl className="mt-4 divide-y divide-slate-800/60">
          <ReceiptField label="Type">{detail.type.replace(/_/g, " ")}</ReceiptField>

          {isTransfer ? (
            <>
              <ReceiptField label="From" mono>
                <AddressValue address={fromAddress} partyId={ownAddress} />
              </ReceiptField>
              <ReceiptField label="To" mono>
                <AddressValue address={toAddress} partyId={ownAddress} />
              </ReceiptField>
            </>
          ) : detail.counterparty ? (
            <ReceiptField label="Counterparty" mono>
              {detail.counterparty}
            </ReceiptField>
          ) : null}

          <ReceiptField label="Network fee">
            <span className="tabular-nums">{feeCc.toFixed(4)} CC</span>
          </ReceiptField>

          {isTransfer && platformFeeCc > 0 ? (
            <ReceiptField label="Platform fee">
              <span className="tabular-nums text-amber-400">{platformFeeCc.toFixed(4)} CC</span>
            </ReceiptField>
          ) : null}

          {roundDisplay ? (
            <ReceiptField label="Round">
              <span className="tabular-nums">#{roundDisplay}</span>
            </ReceiptField>
          ) : null}

          <ReceiptField label={t("transactions.when")}>
            {new Date(detail.createdAt).toLocaleString()}
          </ReceiptField>

          <ReceiptField label="Status">
            <span className="inline-flex items-center gap-1.5">
              {detail.onChainSettled ? (
                <>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-green-500" />
                  <span className="font-semibold">Settled</span>
                </>
              ) : (
                <span className="font-medium text-slate-400">Pending</span>
              )}
            </span>
          </ReceiptField>

          {txId ? (
            <ReceiptField label="Tx ID" mono>
              <span className="inline-flex items-center justify-end gap-1.5">
                {lighthouseUrl ? (
                  <a
                    href={lighthouseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] underline-offset-2 hover:underline"
                  >
                    {truncateMiddle(txId)}
                  </a>
                ) : (
                  <span>{truncateMiddle(txId)}</span>
                )}
                <InlineCopyButton value={txId} label="Copy transaction ID" />
              </span>
            </ReceiptField>
          ) : null}
        </dl>

        {detail.cantonScanUrl ? (
          <a
            href={detail.cantonScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/5 bg-[var(--muted)]/40 px-5 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-[var(--muted)]"
          >
            View on CantonScan
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      {showLedgerEvents ? (
        <div
          className={cn(
            "w-full min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
            compact ? "mt-4 p-5" : "mt-5 p-8",
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
      ) : !isTransfer && detail.ledgerFetchError ? (
        <p className="mt-4 text-sm font-medium text-slate-400">{detail.ledgerFetchError}</p>
      ) : null}
    </>
  );
}
