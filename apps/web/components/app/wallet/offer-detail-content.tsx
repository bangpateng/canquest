"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Undo2,
  X,
  Zap,
} from "lucide-react";

import { displayName } from "@/components/app/wallet/token-logo";
import type {
  PendingOfferDetail,
  TransactionDetail,
} from "@/components/app/wallet/transaction-detail-view";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useOfferActions } from "@/lib/wallet/use-offer-actions";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * Detail LEDGER untuk offer yang belum di-accept.
 *
 * Saat transfer butuh persetujuan penerima, dana BELUM berpindah — yang ada di
 * ledger hanyalah kontrak offer. Menampilkannya sebagai transaksi final (dengan
 * tx id + link explorer) menyesatkan: di explorer kontrak itu memang tampil
 * sebagai "pending acceptance" selamanya, dan user mengira transaksinya macet.
 *
 * Karena itu baris pending dirender di sini sebagai fakta ledger: kontrak offer,
 * dua pihak, batas waktu accept, dan fee yang sudah dibayar saat offer dibuat.
 * TX final baru muncul setelah accept (baris ter-flip COMPLETED).
 *
 * Instrument-agnostic — CC (Amulet), USDCx, CBTC, token registry lain memakai
 * jalur yang sama; yang membedakan hanya label token.
 */

function truncateMiddle(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard tidak tersedia — abaikan */
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

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-sm font-medium text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm font-semibold text-[var(--foreground)] [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

/** Sisa waktu sampai offer kedaluwarsa, dalam kalimat ringkas. */
function expiryText(expiresAt: string): string | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  const ms = at - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest > 0 ? `${days}d ${rest}h left` : `${days}d left`;
  }
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

/**
 * Label pihak untuk ditampilkan.
 *
 * `counterparty` dari backend adalah SATU party lawan (dari sudut pandang user),
 * jadi ia hanya boleh dipakai untuk sisi yang BUKAN user. Memakainya untuk kedua
 * sisi membuat From dan To menampilkan alamat yang sama. Sisi user sendiri
 * ditandai "(You)" supaya arah dana tetap terbaca.
 */
function partyLabel(
  partyId: string,
  counterparty: string | null,
  isSelf: boolean,
): ReactNode {
  if (isSelf) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span>{truncateMiddle(partyId, 14, 6)}</span>
        <span className="text-xs font-medium text-[var(--muted-foreground)]">
          (You)
        </span>
      </span>
    );
  }
  const resolved = counterparty?.trim();
  return resolved || truncateMiddle(partyId, 14, 6);
}

type OfferDetailContentProps = {
  detail: TransactionDetail;
  offer: PendingOfferDetail;
  compact?: boolean;
};

export function OfferDetailContent({
  detail,
  offer,
  compact = false,
}: OfferDetailContentProps) {
  const role = detail.offerRole ?? null;
  const isReceiver = role === "receiver";
  const isSender = role === "sender";
  const token = displayName(offer.instrumentId || "Amulet");
  const amount = Number(offer.amount);
  const amountText = Number.isFinite(amount)
    ? `${amount.toFixed(4)} ${token}`
    : token;
  const remaining = expiryText(offer.expiresAt ?? "");
  // Fee dibayar pengirim saat offer dibuat (satu batch dengan transfer).
  const feeCc = detail.platformFeeMicroCc
    ? Math.abs(Number(detail.platformFeeMicroCc)) / 1_000_000
    : 0;

  const { run, processing, passphraseModal } = useOfferActions();
  const [message, setMessage] = useState<string | null>(null);
  const busy = processing !== null;

  // Sisi mana milik user ditentukan peran offer dari backend (dihitung atas
  // party id), bukan mencocokkan alamat yang bisa beda casing.

  async function act(action: "accept" | "reject" | "withdraw") {
    const outcome = await run(action, {
      contractId: offer.contractId,
      type: offer.type,
      instrumentId: offer.instrumentId,
      amount: offer.amount,
    });
    if (outcome) setMessage(outcome.message);
  }

  return (
    <>
      {passphraseModal}
      <div
        className={cn(
          "w-full min-w-0",
          compact
            ? ""
            : "overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8",
        )}
      >
        {/* Hero — arah mengikuti peran user: penerima menunggu dana masuk,
            pengirim sudah mengirim (dana masih di escrow offer). */}
        <div className="flex flex-col items-center text-center">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full",
              isSender
                ? "bg-red-500/15 text-red-600"
                : "bg-green-500/15 text-green-600",
            )}
            aria-hidden
          >
            {isSender ? (
              <ArrowUpRight className="h-5 w-5" />
            ) : (
              <ArrowDownLeft className="h-5 w-5" />
            )}
          </span>
          <p
            className={cn(
              "mt-3 font-bold tabular-nums",
              compact ? "text-3xl" : "text-4xl",
              isSender ? "text-red-600" : "text-green-600",
            )}
          >
            {isSender ? "\u2212" : "+"}
            {amountText}
          </p>
          <p className="mt-1 text-sm font-medium text-amber-600">
            Awaiting acceptance
          </p>
        </div>

        <dl className="mt-4 divide-y divide-[var(--border)]">
          <Field label="From">
            <span className="inline-flex items-center justify-end gap-1.5">
              <span className="font-mono">
                {partyLabel(offer.sender, detail.counterparty, isSender)}
              </span>
              <CopyButton value={offer.sender} label="Copy sender party" />
            </span>
          </Field>
          <Field label="To">
            <span className="inline-flex items-center justify-end gap-1.5">
              <span className="font-mono">
                {partyLabel(offer.receiver, detail.counterparty, isReceiver)}
              </span>
              <CopyButton value={offer.receiver} label="Copy receiver party" />
            </span>
          </Field>

          {remaining ? (
            <Field label="Expires">
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {remaining}
              </span>
            </Field>
          ) : null}

          {/* Fee hangus saat offer dibuat — penerima tidak membayar apa pun,
              jadi baris ini hanya relevan bagi pengirim. */}
          {isSender && feeCc > 0 ? (
            <Field label="Platform fee">
              {`${feeCc.toFixed(4)} CC (paid)`}
            </Field>
          ) : null}

          {offer.description ? (
            <Field label="Memo">{offer.description}</Field>
          ) : null}

          <Field label="Offer ID">
            <span className="inline-flex items-center justify-end gap-1.5">
              <span className="font-mono">
                {truncateMiddle(offer.contractId)}
              </span>
              <CopyButton value={offer.contractId} label="Copy offer id" />
            </span>
          </Field>

          <Field label="Status">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
              <Clock className="h-3 w-3 shrink-0" />
              Awaiting acceptance
            </span>
          </Field>
        </dl>

        {message ? (
          <p className="mt-4 rounded-2xl border border-green-500/20 bg-green-500/5 px-4 py-2.5 text-sm font-medium text-green-600">
            {message}
          </p>
        ) : null}

        {/* Aksi: penerima menerima/menolak; pengirim menarik kembali offer.
            Peran tidak diketahui → tampilkan catatan, tanpa tombol menebak. */}
        {isReceiver || isSender ? (
          <div className="mt-5 flex items-center gap-2">
            {isReceiver ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("accept")}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "flex-1 justify-center gap-1.5 border-green-500/20 text-green-600 hover:border-green-500/40 hover:text-green-300",
                  )}
                >
                  {processing?.action === "accept" ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("reject")}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "flex-1 justify-center gap-1.5 border-red-500/20 text-red-600 hover:border-red-500/40 hover:text-red-300",
                  )}
                >
                  {processing?.action === "reject" ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("withdraw")}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "flex-1 justify-center gap-1.5",
                )}
              >
                {processing?.action === "withdraw" ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Withdraw
              </button>
            )}
          </div>
        ) : (
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
            <Zap className="h-3.5 w-3.5" />
            Waiting for the recipient to accept.
          </p>
        )}
      </div>
    </>
  );
}
