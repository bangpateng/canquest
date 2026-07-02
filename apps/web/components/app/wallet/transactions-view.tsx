"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowUpRight, Ban, Gift, Lock, LockOpen, RefreshCw, ShieldCheck, ShieldOff, Undo2, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { queryKeys } from "@/lib/queries/query-keys";

export const TRANSACTIONS_PAGE_SIZE = 5;
/** On-chain (Modo API) is the SINGLE source of transaction history.
 * Each item is a Canton CC transfer from Modo /transfers/{partyId}, with a
 * correct explorer link (scan_url → cc.modo.link/mainnet/updates/{id}). */
const ONCHAIN_TRANSACTIONS_PROXY = "/api/party/transactions/onchain";

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
    | "PREAPPROVAL_DISABLED";
  description: string;
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
  /** Modo event id (format "122072…:0") — used for the explorer link. */
  eventId?: string | null;
  /** Modo explorer link for this on-chain item (injected by backend). */
  cantonScanUrl?: string | null;
  /** Network fee paid, in microCC. */
  networkFeeMicroCc?: string | null;
  /** Canton round number the transaction settled in. */
  round?: number | string | null;
  /** Estimated USD value of the amount, if known. */
  usdEstimate?: number | null;
}


interface TxPage {
  items: TxItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Raw on-chain transfer shape returned by /party/transactions/onchain (Modo). */
interface OnchainTx {
  event_id: string;
  update_id?: string;
  transfer_type?: string;
  amount: number | string;
  fee: number | string;
  created_at: number;
  sender_address: string | null;
  sender_name?: string | null;
  receiver_address: string | null;
  receiver_name?: string | null;
  network_fee: string;
  scan_url: string | null;
}

interface OnchainResponse {
  transactions: OnchainTx[];
  pagination?: { has_next?: boolean; next_cursor?: string | null } | null;
}

/** microCC helper: Modo `amount` is CC (decimal), DB stores microCC (int). */
function ccToMicroCc(cc: number | string): string {
  return String(Math.round(Math.abs(Number(cc) || 0) * 1_000_000));
}

/** Map a Modo on-chain transfer to the TxItem shape used by the list/detail UI. */
function onchainToTxItem(tx: OnchainTx, ownPartyId: string): TxItem {
  const isOut = tx.sender_address === ownPartyId;
  const type: TxItem["type"] = isOut ? "TRANSFER_OUT" : "TRANSFER_IN";
  return {
    id: tx.event_id,
    amountMicroCc: ccToMicroCc(tx.amount),
    type,
    description: isOut ? "Sent CC (on-chain)" : "Received CC (on-chain)",
    referenceId: isOut ? tx.receiver_address : tx.sender_address,
    counterparty: isOut ? tx.receiver_address : tx.sender_address,
    ledgerTxId: tx.update_id ?? tx.event_id,
    cantonUpdateId: tx.update_id ?? null,
    settledAt: new Date(tx.created_at).toISOString(),
    createdAt: new Date(tx.created_at).toISOString(),
    status: "COMPLETED",
    source: "onchain",
    partyId: ownPartyId,
    senderAddress: tx.sender_address,
    receiverAddress: tx.receiver_address,
    eventId: tx.event_id,
    cantonScanUrl: tx.scan_url,
    networkFeeMicroCc: tx.network_fee,
  };
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
};

/** Type toggle onchain (reject/withdraw/preapproval) — amount 0, tampil netral. */
const TOGGLE_TX_TYPES: ReadonlySet<TxItem["type"]> = new Set([
  "OFFER_REJECTED",
  "OFFER_WITHDRAWN",
  "PREAPPROVAL_ENABLED",
  "PREAPPROVAL_DISABLED",
]);

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
      return <Ban className="h-4 w-4" />;
    case "OFFER_WITHDRAWN":
      return <Undo2 className="h-4 w-4" />;
    case "PREAPPROVAL_ENABLED":
      return <ShieldCheck className="h-4 w-4" />;
    case "PREAPPROVAL_DISABLED":
      return <ShieldOff className="h-4 w-4" />;
    case "QUEST_REWARD":
    case "SPIN_REWARD":
    case "AIRDROP":
      return <Gift className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
}

function txIconBg(type: TxItem["type"]): string {
  switch (type) {
    case "TRANSFER_OUT":
      return "bg-red-500/10 text-red-500";
    case "TRANSFER_IN":
      return "bg-green-500/10 text-green-500";
    case "CC_LOCK":
      // Netral/amber — BUKAN merah transfer (dana dikunci, bukan keluar).
      return "bg-amber-500/10 text-amber-500";
    case "CC_UNLOCK":
      return "bg-green-500/10 text-green-500";
    case "OFFER_REJECTED":
    case "OFFER_WITHDRAWN":
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
    default:
      return "bg-blue-500/10 text-blue-500";
  }
}

function amountColor(type: TxItem["type"]): string {
  // Toggle (amount 0) → slate netral.
  if (TOGGLE_TX_TYPES.has(type)) return "text-slate-400";
  // CC_LOCK = debit (amber, netral — bukan merah transfer).
  if (type === "CC_LOCK") return "text-amber-500";
  return type === "TRANSFER_OUT" ? "text-red-500" : "text-green-500";
}

function amountSign(type: TxItem["type"]): string {
  // Toggle → tanpa tanda (amount 0).
  if (TOGGLE_TX_TYPES.has(type)) return "";
  // CC_LOCK = tanda − (dana dikunci / arah keluar untuk display).
  return type === "TRANSFER_OUT" || type === "CC_LOCK" ? "\u2212" : "+";
}

/** Render amount cell: toggle (amount 0) → "—" netral, bukan "+0.0000 CC". */
function AmountText({ tx }: { tx: TxItem }) {
  if (TOGGLE_TX_TYPES.has(tx.type)) {
    return <span className="text-slate-500">\u2014</span>;
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

type TransactionsViewProps = {
  variant?: "page" | "embedded";
  pageSize?: number;
  refreshKey?: number;
  className?: string;
  /** Canton party ID for on-chain lookup (Modo API). If empty, skip on-chain. */
  partyId?: string | null;
};


export function TransactionsView({
  variant = "page",
  pageSize = TRANSACTIONS_PAGE_SIZE,
  refreshKey = 0,
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
    return type === "TRANSFER_OUT" ? "Sent" : "Received";
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [modalTx, setModalTx] = useState<TxItem | null>(null);

  // ── Data: TanStack Query (background refetch SILENT, no flicker) ──────────
  // History 100% dari API Modo (on-chain per-party transfers). Setiap baris =
  // transfer CC on-chain dengan link explorer (cc.modo.link). refetchInterval
  // menggantikan polling manual; refetch saat tab focus otomatis. `loading`
  // (isPending) hanya true saat first-load — poll background SILENT.
  const POLL_MS = 60_000;
  const query = useQuery({
    queryKey: queryKeys.party.transactions.page(currentPage),
    queryFn: async (): Promise<TxPage> => {
      if (!partyId) {
        return { items: [], total: 0, page: currentPage, pageSize, totalPages: 0 };
      }
      // Fetch on-chain transfers from Modo (paginated server-side; grab a
      // generous batch then slice locally — the API is cursor-based, so for
      // now we pull the newest page which covers typical history depth).
      const res = await fetch(
        `${ONCHAIN_TRANSACTIONS_PROXY}?limit=100`,
        { credentials: "include", cache: "no-store" },
      ).catch(() => null);
      const data = res?.ok ? ((await res.json()) as OnchainResponse) : null;
      const raw: OnchainTx[] = data?.transactions ?? [];

      const all: TxItem[] = raw.map((tx) => onchainToTxItem(tx, partyId));
      // Modo returns newest-first already, but sort defensively.
      all.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const start = (currentPage - 1) * pageSize;
      const paged = all.slice(start, start + pageSize);
      return {
        items: paged,
        total: all.length,
        page: currentPage,
        pageSize,
        totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      };
    },
    enabled: Boolean(partyId),
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  const txPage = query.data ?? null;
  // First-load spinner (isPending), BUKAN isFetching → poll background silent.
  const loading = query.isPending;

  // refreshKey bump dari parent (wallet-dashboard) → invalidate semua halaman tx.
  useEffect(() => {
    if (refreshKey === 0) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.transactions.all });
  }, [refreshKey, queryClient]);

  function changePage(p: number) {
    setCurrentPage(p);
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.transactions.all });
  }

  return (
    <div className={cn(embedded ? "" : "space-y-8", className)}>
      {!embedded ? (
        <h2 className="text-2xl font-bold text-slate-100"></h2>
      ) : null}

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
                           {tx.description}
                         </td>
                         <td className="px-5 py-3.5 sm:px-6 sm:py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-xs font-medium text-[var(--primary)]">
                            {tx.cantonUpdateId
                              ? `${tx.cantonUpdateId.slice(0, 10)}\u2026`
                              : tx.ledgerTxId
                                ? `${tx.ledgerTxId.slice(0, 10)}\u2026`
                                : "View"}
                          </span>
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
                           {tx.description}
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

      {/* Transaction Detail Modal.
          On-chain items (id "lh-…") are rendered directly from the TxItem —
          they don't exist in the DB and a fetch would 404. DB items fetch as before. */}
      <TransactionDetailModal
        open={modalTx !== null}
        transactionId={modalTx?.id ?? null}
        partyId={partyId ?? null}
        onchainTx={modalTx?.source === "onchain" ? modalTx : null}
        onClose={() => setModalTx(null)}
      />


    </div>
  );
}