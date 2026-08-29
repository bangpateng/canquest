"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Ban, Check, Copy, ExternalLink, Lock, LockOpen, Zap } from "lucide-react";

import type { TransactionDetail } from "@/components/app/wallet/transaction-detail-view";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { useTokenPrices } from "@/lib/hooks/use-token-prices";
import { tokenPriceKey } from "@/components/app/earn/cc-usd-value";
import { txTypeLabel } from "@/lib/canton/tx-labels";
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
  if (!address) return <span className="text-[var(--muted-foreground)]">{"\u2014"}</span>;
  const isYou = partyIdsEqual(address, partyId);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{address}</span>
      {isYou ? (
        <span className="text-xs font-medium text-[var(--muted-foreground)]">(You)</span>
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
      className={iconButtonClass("h-7 w-7 shrink-0 text-[var(--foreground)]")}
      aria-label={label}
    >
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-green-600" />
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
      <dt className="shrink-0 text-sm font-medium text-[var(--muted-foreground)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm font-semibold text-[var(--foreground)] [overflow-wrap:anywhere]",
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

export function TransactionDetailContent({
  detail,
  loading,
  error,
  partyId = null,
  compact = false,
}: TransactionDetailContentProps) {
  const t = usePlatformT();
  const { prices } = useTokenPrices();

  if (loading) {
    return (
      <div className={cn("flex justify-center", compact ? "py-10" : "py-24")}>
        <LoadingSpinner size="xl" tone="muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--muted-foreground)]">{error}</p>
      </div>
    );
  }

  if (!detail) return null;

  const ccAmt = microCcToCc(detail.amountMicroCc);
  const isOut = detail.type === "TRANSFER_OUT";
  const isIn = detail.type === "TRANSFER_IN";
  const isLock = detail.type === "CC_LOCK";
  const isUnlock = detail.type === "CC_UNLOCK";
  // Token non-CC (CIP-0056 P2P transfer, mis. USDCx).
  const isTokenOut = detail.type === "TOKEN_TRANSFER_OUT";
  const isTokenIn = detail.type === "TOKEN_TRANSFER_IN";
  const isTokenTransfer = isTokenOut || isTokenIn;
  const isTransfer = isOut || isIn || isTokenTransfer;
  // Toggle onchain (reject/withdraw/preapproval, CC maupun token) — amount 0, netral.
  const isToggle =
    detail.type === "OFFER_REJECTED" ||
    detail.type === "OFFER_WITHDRAWN" ||
    detail.type === "TOKEN_OFFER_REJECTED" ||
    detail.type === "TOKEN_OFFER_WITHDRAWN" ||
    detail.type === "PREAPPROVAL_ENABLED" ||
    detail.type === "PREAPPROVAL_DISABLED";
  // Cancelled offer (reject/withdraw) yang MEMILIKI amount orisinal — tampilkan
  // "−X CC/USDCx" (cancelled). PREAPPROVAL tetap netral (tidak punya amount).
  const isCancelled =
    detail.type === "OFFER_REJECTED" ||
    detail.type === "OFFER_WITHDRAWN" ||
    detail.type === "TOKEN_OFFER_REJECTED" ||
    detail.type === "TOKEN_OFFER_WITHDRAWN";
  const isCancelledToken =
    detail.type === "TOKEN_OFFER_REJECTED" ||
    detail.type === "TOKEN_OFFER_WITHDRAWN";
  const cancelledRaw = isCancelledToken
    ? detail.cancelledAmount
    : detail.cancelledAmountCc;
  const cancelledAmt = Number(cancelledRaw ?? "0");
  const hasCancelledAmount =
    isCancelled && cancelledRaw != null && Number.isFinite(cancelledAmt) && cancelledAmt > 0;
  const cancelledLabel = isCancelledToken
    ? detail.cancelledInstrumentId ?? detail.instrumentId ?? "token"
    : "CC";
  // Debit (negatif): TRANSFER_OUT, TOKEN_TRANSFER_OUT & CC_LOCK.
  const isDebit = isOut || isTokenOut || isLock;
  // Token non-CC: amount sudah unit asli (amountDecimal), suffix = instrumentId.
  const isTokenAmountTx =
    isTokenTransfer &&
    detail.instrumentId != null &&
    detail.instrumentId !== "Amulet" &&
    detail.amountDecimal != null;
  const tokenAmt = isTokenAmountTx ? Math.abs(Number(detail.amountDecimal)) : 0;

  // User's own wallet address — prefer the detail's stored party, fall back to prop.
  const ownAddress = detail.cantonPartyId ?? partyId ?? null;

  // From / To use the REAL sender/receiver addresses. We only tag the one that
  // matches the user's party as "(You)" — never default both to the user.
  // Token transfer juga diperlakukan seperti CC transfer (direction sama).
  const fromAddress =
    detail.senderAddress ??
    (isOut || isTokenOut ? ownAddress : detail.counterparty) ??
    null;
  const toAddress =
    detail.receiverAddress ??
    (isIn || isTokenIn ? ownAddress : detail.counterparty) ??
    null;

  // Tx ID untuk copy — HANYA id on-chain real (event/update/contract id).
  // JANGAN fallback ke detail.id (DB cuid) — itu menyesatkan user. Marker internal
  // (fee/inbound-sync/unlock/preapproval/reward-) disembunyikan (bukan on-chain tx).
  // Tx ID ditampilkan sebagai teks biasa + tombol copy (tanpa link explorer) —
  // user bisa cek sendiri ke explorer pilihannya.
  const isInternal = detail.isInternalMarker === true;
  const rawTxId =
    detail.eventId ?? detail.cantonUpdateId ?? detail.ledgerContractId ?? null;
  const txId = isInternal ? null : rawTxId;

  const roundDisplay =
    detail.round != null && detail.round !== "" ? String(detail.round) : null;

  // Estimasi USD utk nominal hero — dihitung dari harga LIVE /party/prices
  // (harga saat dibuka, prefix "≈"). detail.usdEstimate backend (bila suatu
  // saat diisi) tetap menang sebagai override.
  const heroUsdToken =
    isToggle && !hasCancelledAmount
      ? null
      : hasCancelledAmount
        ? { amount: cancelledAmt, token: cancelledLabel }
        : isTokenAmountTx
          ? { amount: tokenAmt, token: detail.instrumentId ?? "token" }
          : ccAmt > 0
            ? { amount: ccAmt, token: "CC" }
            : null;
  const heroPriceKey = heroUsdToken ? tokenPriceKey(heroUsdToken.token) : null;
  const heroPrice = heroPriceKey ? prices[heroPriceKey] : undefined;
  const liveUsd =
    heroUsdToken && heroPrice && heroUsdToken.amount > 0
      ? heroUsdToken.amount * heroPrice
      : null;
  const usdDisplay =
    typeof detail.usdEstimate === "number" && Number.isFinite(detail.usdEstimate)
      ? detail.usdEstimate
      : liveUsd;

  // For on-chain transfers the fields already show everything — hide the
  // separate "On-chain events" block so the modal fits without scrolling.
  const showLedgerEvents = !isTransfer && detail.ledgerEvents.length > 0;

  return (
    <>
      <div
        className={cn(
          "w-full min-w-0",
          compact
            ? ""
            : "overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8",
        )}
      >
        {/* Centered amount hero */}
        <div className="flex flex-col items-center text-center">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full",
              isToggle
                ? "bg-[var(--muted)] text-[var(--muted-foreground)]"
                : isLock
                  ? "bg-amber-500/15 text-amber-600"
                  : isUnlock || isIn || isTokenIn
                    ? "bg-green-500/15 text-green-600"
                    : "bg-red-500/15 text-red-600",
            )}
            aria-hidden
          >
            {isLock ? (
              <Lock className="h-5 w-5" />
            ) : isUnlock ? (
              <LockOpen className="h-5 w-5" />
            ) : isIn || isTokenIn ? (
              <ArrowDownLeft className="h-5 w-5" />
            ) : isOut || isTokenOut ? (
              <ArrowUpRight className="h-5 w-5" />
            ) : (
              <Zap className="h-5 w-5" />
            )}
          </span>
          <p
            className={cn(
              "mt-3 font-bold tabular-nums",
              compact ? "text-3xl" : "text-4xl",
              isToggle
                ? "text-[var(--muted-foreground)]"
                : isLock
                  ? "text-amber-600"
                  : isOut
                    ? "text-red-600"
                    : "text-green-600",
            )}
          >
            {isToggle && !hasCancelledAmount
              ? ""
              : isDebit || hasCancelledAmount
                ? "\u2212"
                : "+"}
            {isToggle && !hasCancelledAmount
              ? "—"
              : hasCancelledAmount
                ? `${cancelledAmt.toFixed(4)} ${cancelledLabel}`
                : isTokenAmountTx
                  ? `${tokenAmt.toFixed(4)} ${detail.instrumentId}`
                  : `${ccAmt.toFixed(4)} CC`}
          </p>
          {usdDisplay != null ? (
            <p className="mt-0.5 text-sm font-medium text-[var(--muted-foreground)] tabular-nums">
              ≈ $
              {usdDisplay >= 1
                ? usdDisplay.toFixed(2)
                : usdDisplay >= 0.01
                  ? usdDisplay.toFixed(3)
                  : usdDisplay.toFixed(4)}{" "}
              USD
            </p>
          ) : null}
        </div>

        <dl className="mt-4 divide-y divide-[var(--border)]">
          <ReceiptField label="Type">{txTypeLabel(detail.type, t)}</ReceiptField>

          {isTransfer ? (
            <>
              <ReceiptField label="From" mono>
                {fromAddress ? (
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <AddressValue address={fromAddress} partyId={ownAddress} />
                    <InlineCopyButton value={fromAddress} label="Copy sender address" />
                  </span>
                ) : (
                  <AddressValue address={fromAddress} partyId={ownAddress} />
                )}
              </ReceiptField>
              <ReceiptField label="To" mono>
                {toAddress ? (
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <AddressValue address={toAddress} partyId={ownAddress} />
                    <InlineCopyButton value={toAddress} label="Copy recipient address" />
                  </span>
                ) : (
                  <AddressValue address={toAddress} partyId={ownAddress} />
                )}
              </ReceiptField>
            </>
          ) : detail.counterparty ? (
            <ReceiptField label="Counterparty" mono>
              {detail.counterparty}
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
            {(() => {
              // Badge pill untuk status: Completed (hijau), Pending (amber), Rejected (merah).
              const pill =
                detail.status === "PENDING"
                  ? "inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600"
                  : detail.status === "REJECTED"
                    ? "inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-600"
                    : detail.onChainSettled
                      ? "inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-600"
                      : "inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600";
              return (
                <span className={pill}>
                  {detail.status === "REJECTED" ? (
                    <Ban className="h-3 w-3 shrink-0" />
                  ) : (
                    <Check className="h-3 w-3 shrink-0" />
                  )}
                  {detail.status === "PENDING"
                    ? "Pending"
                    : detail.status === "REJECTED"
                      ? "Rejected"
                      : detail.onChainSettled
                        ? "Completed"
                        : "Pending"}
                </span>
              );
            })()}
          </ReceiptField>

          {txId ? (() => {
            // Link explorer: PRIORITAS cantonScanUrl dari backend (Modo —
            // cc.modo.link, netral utk semua instrument CC/USDCx/CBTC).
            // Fallback ccview.io dengan cantonUpdateId/txId. (Sebelumnya
            // ccview di-hardcode — tx USDCx kelihatan "link CC" padahal
            // tx-nya benar.) Strip suffix :N (eventId bisa bawa round).
            const fallbackId = (detail.cantonUpdateId ?? txId)?.replace(
              /:[0-9]+$/,
              "",
            );
            const explorerUrl =
              detail.cantonScanUrl ??
              (fallbackId
                ? `https://ccview.io/updates/${encodeURIComponent(fallbackId)}/`
                : null);
            return (
              <ReceiptField label="Tx ID" mono>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-canton underline-offset-2 hover:underline"
                      title={txId}
                    >
                      {truncateMiddle(txId)}
                    </a>
                  ) : (
                    <span>{truncateMiddle(txId)}</span>
                  )}
                  <InlineCopyButton value={txId} label="Copy transaction ID" />
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={iconButtonClass("h-7 w-7 shrink-0 text-canton")}
                      aria-label="View on explorer"
                      title="View on explorer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </span>
              </ReceiptField>
            );
          })() : null}
        </dl>
      </div>

      {showLedgerEvents ? (
        <div
          className={cn(
            "w-full min-w-0 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]",
            compact ? "mt-4 p-5" : "mt-5 p-8",
          )}
        >
          <h3 className="text-base font-bold text-[var(--foreground)]">On-chain events</h3>
          <p className="mt-2 text-sm font-medium text-[var(--muted-foreground)]">
            Contract lifecycle visible to your wallet.
          </p>
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {detail.ledgerEvents.map((ev, i) => (
              <li key={`${ev.contractId}-${i}`} className="py-3">
                <p className="text-base font-semibold capitalize text-[var(--foreground)]">{ev.kind}</p>
                <p className="mt-1 font-mono text-sm font-medium text-[var(--muted-foreground)]">
                  {shortTemplate(ev.templateId)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : !isTransfer && detail.ledgerFetchError ? (
        <p className="mt-4 text-sm font-medium text-[var(--muted-foreground)]">{detail.ledgerFetchError}</p>
      ) : null}
    </>
  );
}
