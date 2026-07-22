"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Coins, Gift, Lock, LockOpen, RefreshCw, ShieldCheck, ShieldOff, Undo2, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { queryKeys } from "@/lib/queries/query-keys";

export const TRANSACTIONS_PAGE_SIZE = 5;
/** Server-side proxy to DB transactions — SINGLE source of truth.
 * Merge on-chain dihapus dari list untuk mencegah duplikat (format id beda
 * antara DB update_id dan onchain event_id). Link explorer tetap di-resolve
 * backend (kini via Modo) saat buka detail. */
const DB_TRANSACTIONS_PROXY = "/api/party/transactions";

export interface TxItem {
  id: string;
  amountMicroCc: string;
  type:
    | "QUEST_REWARD"
    | "SPIN_REWARD"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "AIRDROP"
    | "CC_LOCK"
    | "CC_UNLOCK"
    | "OFFER_REJECTED"
    | "OFFER_WITHDRAWN"
    | "PREAPPROVAL_ENABLED"
    | "PREAPPROVAL_DISABLED"
    | "SWAP_OUT"
    | "SWAP_IN"
    // Token non-CC (CIP-0056 P2P transfer, mis. USDCx).
    | "TOKEN_TRANSFER_IN"
    | "TOKEN_TRANSFER_OUT"
    | "TOKEN_OFFER_REJECTED"
    | "TOKEN_OFFER_WITHDRAWN";
  description: string;
  /** Instrument id untuk token non-CC (mis. "USDCx"). null untuk CC murni. */
  instrumentId?: string | null;
  /** Amount token dalam unit asli (Decimal string). null untuk CC (pakai amountMicroCc). */
  amountDecimal?: string | null;
  /** Admin party untuk token non-CC (mis. "DSO::1220..."). */
  instrumentAdmin?: string | null;
  referenceId: string | null;
  counterparty?: string | null;
  ledgerTxId: string | null;
  cantonUpdateId?: string | null;
  settledAt: string | null;
  createdAt: string;
  /** COMPLETED (default) | PENDING (offer belum di-accept) | REJECTED */
  status?: "COMPLETED" | "PENDING" | "REJECTED";
  transferInstructionCid?: string | null;
  /** On-chain source marker */
  source?: "db" | "onchain";
  /** Owner party (used to highlight "You" in the detail modal). */
  partyId?: string | null;
  /** Real sender address (on-chain). */
  senderAddress?: string | null;
  /** Real receiver address (on-chain). */
  receiverAddress?: string | null;
  /** Explorer event/update id — used for the explorer link. */
  eventId?: string | null;
  /** True bila tx id marker internal (fee/inbound-sync/unlock/preapproval/reward-)
   *  — link explorer disembunyikan. */
  isInternalMarker?: boolean;
  /** Explorer link for this on-chain item (injected by backend via Modo). */
  cantonScanUrl?: string | null;
  /** Network fee paid, in microCC. */
  networkFeeMicroCc?: string | null;
  /** Canton round number the transaction settled in. */
  round?: number | string | null;
  /** Estimated USD value of the amount, if known. */
  usdEstimate?: number | null;
  /** Jumlah CC asli yang dibatalkan/ditolak (OFFER_WITHDRAWN / OFFER_REJECTED).
   *  Saldo tidak bergerak (amountMicroCc=0); ini untuk display "cancelled X CC". */
  cancelledAmountCc?: string | null;
  /** Jumlah token asli yang dibatalkan (TOKEN_OFFER_WITHDRAWN / REJECTED). */
  cancelledAmount?: string | null;
  /** Instrument id token yang dibatalkan (mis. "USDCx"). */
  cancelledInstrumentId?: string | null;
}


interface TxPage {
  items: TxItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const TX_TYPE_KEYS: Record<TxItem["type"], string> = {
  QUEST_REWARD: "transactions.questReward",
  SPIN_REWARD: "transactions.spinReward",
  TRANSFER_IN: "transactions.receivedCc",
  TRANSFER_OUT: "transactions.sentCc",
  AIRDROP: "transactions.airdrop",
  CC_LOCK: "transactions.ccLocked",
  CC_UNLOCK: "transactions.ccUnlocked",
  OFFER_REJECTED: "transactions.offerRejected",
  OFFER_WITHDRAWN: "transactions.offerWithdrawn",
  PREAPPROVAL_ENABLED: "transactions.preapprovalEnabled",
  PREAPPROVAL_DISABLED: "transactions.preapprovalDisabled",
  SWAP_OUT: "transactions.swapOut",
  SWAP_IN: "transactions.swapIn",
  TOKEN_TRANSFER_IN: "transactions.tokenReceived",
  TOKEN_TRANSFER_OUT: "transactions.tokenSent",
  TOKEN_OFFER_REJECTED: "transactions.tokenOfferRejected",
  TOKEN_OFFER_WITHDRAWN: "transactions.tokenOfferWithdrawn",
};

/** Type toggle onchain (reject/withdraw/preapproval) — amount 0, tampil netral. */
const TOGGLE_TX_TYPES: ReadonlySet<TxItem["type"]> = new Set([
  "OFFER_REJECTED",
  "OFFER_WITHDRAWN",
  "PREAPPROVAL_ENABLED",
  "PREAPPROVAL_DISABLED",
  "TOKEN_OFFER_REJECTED",
  "TOKEN_OFFER_WITHDRAWN",
]);

/** Cancelled types (reject/withdraw) yang MEMILIKI amount orisinal offer — bisa
 *  menampilkan "cancelled X CC/USDCx". Berbeda dari PREAPPROVAL (toggle murni). */
const CANCELLED_TX_TYPES: ReadonlySet<TxItem["type"]> = new Set([
  "OFFER_REJECTED",
  "OFFER_WITHDRAWN",
  "TOKEN_OFFER_REJECTED",
  "TOKEN_OFFER_WITHDRAWN",
]);

/** Semua type token non-CC (CIP-0056). */
const TOKEN_TX_TYPES: ReadonlySet<TxItem["type"]> = new Set([
  "TOKEN_TRANSFER_IN",
  "TOKEN_TRANSFER_OUT",
  "TOKEN_OFFER_REJECTED",
  "TOKEN_OFFER_WITHDRAWN",
]);

/** True jika tx adalah token non-CC dengan amount (bukan toggle). */
function isTokenAmountTx(tx: TxItem): boolean {
  return (
    (tx.type === "TOKEN_TRANSFER_IN" || tx.type === "TOKEN_TRANSFER_OUT") &&
    tx.instrumentId != null &&
    tx.instrumentId !== "Amulet"
  );
}

function TxStatusBadge({ status }: { status?: TxItem["status"] }) {
  if (!status || status === "COMPLETED") return null;
  const isPending = status === "PENDING";
  return (
    <span
      className={cn(
        "ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        isPending ? "bg-amber-500/15 text-amber-600" : "bg-red-500/10 text-red-500",
      )}
    >
      {isPending ? "Pending" : "Rejected"}
    </span>
  );
}

function TxTypeIcon({ type }: { type: TxItem["type"] }) {
  switch (type) {
    case "TRANSFER_OUT":
      return <ArrowUpRight className="h-4 w-4" />;
    case "TRANSFER_IN":
      return <ArrowDownLeft className="h-4 w-4" />;
    case "CC_LOCK":
      return <Lock className="h-4 w-4" />;
    case "CC_UNLOCK":
      return <LockOpen className="h-4 w-4" />;
    case "OFFER_REJECTED":
    case "TOKEN_OFFER_REJECTED":
      return <Ban className="h-4 w-4" />;
    case "OFFER_WITHDRAWN":
    case "TOKEN_OFFER_WITHDRAWN":
      return <Undo2 className="h-4 w-4" />;
    case "PREAPPROVAL_ENABLED":
      return <ShieldCheck className="h-4 w-4" />;
    case "PREAPPROVAL_DISABLED":
      return <ShieldOff className="h-4 w-4" />;
    case "QUEST_REWARD":
    case "SPIN_REWARD":
    case "AIRDROP":
      return <Gift className="h-4 w-4" />;
    case "SWAP_OUT":
    case "SWAP_IN":
      return <ArrowLeftRight className="h-4 w-4" />;
    case "TOKEN_TRANSFER_OUT":
      return <ArrowUpRight className="h-4 w-4" />;
    case "TOKEN_TRANSFER_IN":
      return <Coins className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
}

function txIconBg(type: TxItem["type"]): string {
  switch (type) {
    case "TRANSFER_OUT":
    case "TOKEN_TRANSFER_OUT":
      return "bg-red-500/10 text-red-500";
    case "TRANSFER_IN":
    case "TOKEN_TRANSFER_IN":
      return "bg-green-500/10 text-green-500";
    case "CC_LOCK":
      // Netral/amber — BUKAN merah transfer (dana dikunci, bukan keluar).
      return "bg-amber-500/10 text-amber-500";
    case "CC_UNLOCK":
      return "bg-green-500/10 text-green-500";
    case "OFFER_REJECTED":
    case "OFFER_WITHDRAWN":
    case "TOKEN_OFFER_REJECTED":
    case "TOKEN_OFFER_WITHDRAWN":
    case "PREAPPROVAL_DISABLED":
      // Aksi toggle netral — slate, bukan merah (tidak ada pergerakan CC).
      return "bg-slate-500/10 text-slate-400";
    case "PREAPPROVAL_ENABLED":
      return "bg-blue-500/10 text-blue-400";
    case "QUEST_REWARD":
      return "bg-[var(--primary)]/15 text-[var(--foreground)]";
    case "SPIN_REWARD":
    case "AIRDROP":
      return "bg-purple-500/10 text-purple-500";
    case "SWAP_OUT":
      // CC keluar — merah (sama transfer out).
      return "bg-red-500/10 text-red-500";
    case "SWAP_IN":
      // CC masuk — hijau (sama transfer in).
      return "bg-green-500/10 text-green-500";
    default:
      return "bg-blue-500/10 text-blue-500";
  }
}

function amountColor(type: TxItem["type"]): string {
  // Toggle (amount 0) → slate netral.
  if (TOGGLE_TX_TYPES.has(type)) return "text-slate-400";
  // CC_LOCK = debit (amber, netral — bukan merah transfer).
  if (type === "CC_LOCK") return "text-amber-500";
  // Debit (keluar): TRANSFER_OUT, TOKEN_TRANSFER_OUT.
  if (type === "TRANSFER_OUT" || type === "TOKEN_TRANSFER_OUT")
    return "text-red-500";
  return "text-green-500";
}

function amountSign(type: TxItem["type"]): string {
  // Toggle → tanpa tanda (amount 0).
  if (TOGGLE_TX_TYPES.has(type)) return "";
  // Debit (keluar): TRANSFER_OUT, TOKEN_TRANSFER_OUT, CC_LOCK.
  if (
    type === "TRANSFER_OUT" ||
    type === "TOKEN_TRANSFER_OUT" ||
    type === "CC_LOCK"
  )
    return "\u2212";
  return "+";
}

/** Render amount cell.
 *  - cancelled (reject/withdraw) dengan amount orisinal → "−5.0000 CC" (cancelled)
 *  - toggle (amount 0, no cancelled amount, e.g. preapproval) → "—" netral
 *  - token non-CC (amountDecimal + instrumentId) → "+5.0000 USDCx"
 *  - CC (default) → "+0.2000 CC" (microCC → CC) */
function AmountText({ tx }: { tx: TxItem }) {
  // Cancelled offer (reject/withdraw) — tampilkan amount ASLI yang dibatalkan.
  // Saldo tidak bergerak (amount=0), jadi pakai cancelledAmountCc/cancelledAmount.
  if (CANCELLED_TX_TYPES.has(tx.type)) {
    const tokenCancelled =
      tx.type === "TOKEN_OFFER_REJECTED" ||
      tx.type === "TOKEN_OFFER_WITHDRAWN";
    const rawAmt = tokenCancelled ? tx.cancelledAmount : tx.cancelledAmountCc;
    const amt = Number(rawAmt ?? "0");
    if (!rawAmt || !Number.isFinite(amt) || amt <= 0) {
      // Data lama (sebelum kolom cancelled ada) → tetap netral.
      return <span className="text-slate-500">\u2014</span>;
    }
    const label = tokenCancelled
      ? tx.cancelledInstrumentId ?? tx.instrumentId ?? "token"
      : "CC";
    return (
      <>
        {"\u2212"}
        {amt.toFixed(4)} {label}
      </>
    );
  }
  if (TOGGLE_TX_TYPES.has(tx.type)) {
    return <span className="text-slate-500">\u2014</span>;
  }
  // Token non-CC: amount sudah dalam unit asli (decimal), bukan microCC.
  if (isTokenAmountTx(tx)) {
    const tokenAmt = Math.abs(Number(tx.amountDecimal ?? "0"));
    return (
      <>
        {amountSign(tx.type)}
        {tokenAmt.toFixed(4)} {tx.instrumentId}
      </>
    );
  }
  const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
  return (
    <>
      {amountSign(tx.type)}
      {ccAmt.toFixed(4)} CC
    </>
  );
}

function txDisplayTitle(tx: TxItem, fallback: string): string {
  const d = tx.description?.trim() ?? "";
  if (d.startsWith("Sent ") || d.startsWith("Received ")) {
    return d;
  }
  // Lock/unlock sudah punya judul deskriptif ("CC Locked" / "CC Unlocked").
  if (tx.type === "CC_LOCK" || tx.type === "CC_UNLOCK") {
    return d || fallback;
  }
  return fallback;
}

/** Label description untuk Activity. Description user/memo diprioritaskan;
 *  bila kosong, fallback ke label generik per-tipe (mis. "Sent CC" / "Sent USDCx").
 *  Dipakai supaya kolom description tidak kosong saat sender tidak isi memo. */
function txDisplayDescription(
  tx: TxItem,
  fallback: string,
): string {
  const d = tx.description?.trim() ?? "";
  if (d) return d;
  // Memo kosong → label generik (bukan party-id mentah).
  return fallback;
}

type TransactionsViewProps = {
  variant?: "page" | "embedded";
  pageSize?: number;
  className?: string;
  /** Canton party ID for on-chain lookup (via Modo). If empty, skip on-chain. */
  partyId?: string | null;
};


export function TransactionsView({
  variant = "page",
  pageSize = TRANSACTIONS_PAGE_SIZE,
  className,
  partyId,
}: TransactionsViewProps) {
  const t = usePlatformT();
  const embedded = variant === "embedded";
  const queryClient = useQueryClient();
  // Type column = arah transaksi yang ramah. Lock/unlock pakai label sendiri (bukan Sent/Received).
  const txDirection = (type: TxItem["type"]): string => {
    if (type === "CC_LOCK") return t(TX_TYPE_KEYS.CC_LOCK);
    if (type === "CC_UNLOCK") return t(TX_TYPE_KEYS.CC_UNLOCK);
    if (TOGGLE_TX_TYPES.has(type)) return t(TX_TYPE_KEYS[type]);
    // Token non-CC map ke Sent/Received (sama arah dengan CC transfer).
    if (type === "TOKEN_TRANSFER_OUT") return "Sent";
    if (type === "TOKEN_TRANSFER_IN") return "Received";
    return type === "TRANSFER_OUT" ? "Sent" : "Received";
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [modalTx, setModalTx] = useState<TxItem | null>(null);

  // ── Data: TanStack Query (background refetch SILENT, no flicker) ──────────
  // DB adalah SATU-satunya sumber history. Merge on-chain dihapus (format id
  // beda → duplikat). refetchInterval menggantikan polling manual 20s; refetch
  // saat tab focus/reconnect otomatis. `loading` (isPending) hanya true saat
  // first-load — poll background TIDAK memunculkan spinner (bug lama).
  // SSE jadi sumber utama update; polling ini hanya fallback safety-net.
  const POLL_MS = 60_000;
  const query = useQuery({
    queryKey: queryKeys.party.transactions.page(currentPage),
    queryFn: async (): Promise<TxPage> => {
      if (!partyId) {
        return { items: [], total: 0, page: currentPage, pageSize, totalPages: 0 };
      }
      // THROW saat fetch gagal — jangan return []. Sebelumnya error di-swalllow
      // (catch → null → items []), lalu TanStack menganggap [] sebagai data baru
      // → list flash ke "No transactions". Dengan throw, TanStack mempertahankan
      // data terakhir yang berhasil selama background refetch. (Fix "data ilang".)
      //
      // Server-side pagination: minta hanya halaman aktif (pageSize kecil),
      // bukan fetch 200 lalu slice client-side (over-fetch berat).
      const dbRes = await fetch(
        `${DB_TRANSACTIONS_PROXY}?page=${currentPage}&pageSize=${pageSize}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!dbRes.ok) {
        throw new Error(`transactions ${dbRes.status}`);
      }
      const dbData = (await dbRes.json()) as {
        items?: TxItem[];
        total?: number;
        page?: number;
        pageSize?: number;
        totalPages?: number;
      };
      const items: TxItem[] = (dbData.items ?? []).map((tx) => ({
        ...tx,
        source: "db" as const,
      }));
      const total = typeof dbData.total === "number" ? dbData.total : items.length;
      // Fallback defensif bila backend tidak kirim totalPages.
      const totalPages =
        typeof dbData.totalPages === "number"
          ? dbData.totalPages
          : Math.max(1, Math.ceil(total / pageSize));

      return {
        items,
        total,
        page: typeof dbData.page === "number" ? dbData.page : currentPage,
        pageSize,
        totalPages,
      };
    },
    enabled: Boolean(partyId),
    staleTime: POLL_MS,
    // Real-time via SSE `transaction:new` (lihat use-realtime.ts). Safety-net
    // polling 5 menit kalau SSE putus.
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  const txPage = query.data ?? null;
  // First-load spinner (isPending), BUKAN isFetching → poll background silent.
  const loading = query.isPending;

  function changePage(p: number) {
    setCurrentPage(p);
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.transactions.all });
  }

  return (
    <div className={cn(embedded ? "" : "space-y-8", className)}>
      <div
        className={cn(
          "w-full min-w-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">
              {t("transactions.title")}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="mt-1 shrink-0 text-slate-400 transition-colors hover:text-slate-100 disabled:opacity-40"
            aria-label="Refresh transactions"
          >
            {loading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>

        {loading ? (
          <div
            className={cn(
              "flex items-center justify-center",
              embedded ? "py-12" : "py-20",
            )}
          >
            <LoadingSpinner size="lg" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className={cn("text-center", embedded ? "py-12" : "py-20")}>
            <p className="text-base font-semibold text-white">
              {t("transactions.empty")}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-400">
              Complete quests or send/receive CC to see activity here.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden min-w-0 md:block">
              <table className="w-full table-fixed text-left text-base">
                <thead className="border-b border-white/[0.06] bg-white/[0.01] text-sm font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.type")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.amount")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.description")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.ledgerTx")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.when")}</th>
                  </tr>
                </thead>
                <tbody>
                  {txPage.items.map((tx) => {
                    const date = new Date(tx.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <tr
                        key={tx.id}
                        className="border-t border-white/[0.04] transition-colors hover:bg-white/[0.03] cursor-pointer"
                        onClick={() => setModalTx(tx)}

                      >
                        <td className="px-5 py-3.5 sm:px-6 sm:py-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-xl",
                                txIconBg(tx.type),
                              )}
                            >
                              <TxTypeIcon type={tx.type} />
                            </span>
                            <span className="text-base font-semibold text-white">
                              {txDirection(tx.type)}
                              <TxStatusBadge status={tx.status} />
                            </span>
                          </div>
                        </td>
                        <td
                          className={cn(
                            "px-5 py-3.5 sm:px-6 sm:py-4 text-base font-bold tabular-nums",
                            amountColor(tx.type),
                          )}
                        >
                          <AmountText tx={tx} />
                        </td>
                        <td className="max-w-[12rem] truncate px-5 py-3.5 sm:px-6 sm:py-4 text-sm font-medium text-slate-400">
                           {txDisplayDescription(tx, t(TX_TYPE_KEYS[tx.type]))}
                         </td>
                         <td className="px-5 py-3.5 sm:px-6 sm:py-4">
                          {(() => {
                            // Tampilkan HANYA id on-chain real (update_id "1220…" / contract id).
                            // Marker internal (fee/inbound-sync/unlock/preapproval/reward-) dan
                            // null → tampilkan "View" generik, BUKAN id yang menyesatkan.
                            const raw =
                              tx.cantonUpdateId ?? tx.ledgerTxId ?? null;
                            const looksReal =
                              !!raw &&
                              (raw.startsWith("1220") ||
                                (raw.startsWith("00") && /^[0-9a-f]+$/.test(raw)));
                            return (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-xs font-medium text-[var(--primary)]">
                                {looksReal
                                  ? `${(raw as string).slice(0, 10)}\u2026`
                                  : "View"}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 text-sm font-medium text-slate-400">
                          {date}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-white/[0.04] md:hidden">
              {txPage.items.map((tx) => {
                const date = new Date(tx.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <li key={tx.id}>
                    <button
                      type="button"
                      onClick={() => setModalTx(tx)}
                      className="flex w-full items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] text-left"
                    >

                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          txIconBg(tx.type),
                        )}
                      >
                        <TxTypeIcon type={tx.type} />
                      </div>
                       <div className="min-w-0 flex-1">
                         <p className="truncate text-sm font-semibold text-white">
                           {txDirection(tx.type)}
                           <TxStatusBadge status={tx.status} />
                         </p>
                         <p className="mt-0.5 truncate text-xs font-medium text-slate-400">
                           {txDisplayDescription(tx, t(TX_TYPE_KEYS[tx.type]))}
                         </p>
                         <p className="mt-0.5 text-xs font-medium text-slate-500">{date}</p>
                       </div>
                       <div className="shrink-0 text-right">
                         <p
                           className={cn(
                             "text-sm font-bold tabular-nums",
                             amountColor(tx.type),
                           )}
                         >
                           <AmountText tx={tx} />
                         </p>
                       </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <ListPagination
              className="px-5 pb-4 sm:px-6"
              page={currentPage}
              totalPages={txPage.totalPages}
              total={txPage.total}
              disabled={loading}
              onPageChange={changePage}
            />
          </>
        )}
      </div>

      {/* Transaction Detail Modal — list is DB-only, modal fetches detail by id. */}
      <TransactionDetailModal
        open={modalTx !== null}
        transactionId={modalTx?.id ?? null}
        partyId={partyId ?? null}
        onClose={() => setModalTx(null)}
      />


    </div>
  );
}