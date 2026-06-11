"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowUpRight, Gift, RefreshCw, XCircle, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export const TRANSACTIONS_PAGE_SIZE = 5;

export interface TxItem {
  id: string;
  amountMicroCc: string;
  type: "QUEST_REWARD" | "SPIN_REWARD" | "TRANSFER_IN" | "TRANSFER_OUT" | "AIRDROP";
  description: string;
  referenceId: string | null;
  counterparty?: string | null;
  ledgerTxId: string | null;
  cantonUpdateId?: string | null;
  settledAt: string | null;
  createdAt: string;
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
};

function TxTypeIcon({ type }: { type: TxItem["type"] }) {
  switch (type) {
    case "TRANSFER_OUT":
      return <ArrowUpRight className="h-4 w-4" />;
    case "TRANSFER_IN":
      return <ArrowDownLeft className="h-4 w-4" />;
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
  return type === "TRANSFER_OUT" ? "text-red-500" : "text-green-500";
}

function amountSign(type: TxItem["type"]): string {
  return type === "TRANSFER_OUT" ? "\u2212" : "+";
}

function txDisplayTitle(tx: TxItem, fallback: string): string {
  const d = tx.description?.trim() ?? "";
  if (d.startsWith("Sent ") || d.startsWith("Received ")) {
    return d;
  }
  return fallback;
}

type TransactionsViewProps = {
  variant?: "page" | "embedded";
  pageSize?: number;
  refreshKey?: number;
  className?: string;
};

export function TransactionsView({
  variant = "page",
  pageSize = TRANSACTIONS_PAGE_SIZE,
  refreshKey = 0,
  className,
}: TransactionsViewProps) {
  const t = usePlatformT();
  const embedded = variant === "embedded";
  const txLabel = (type: TxItem["type"]) => t(TX_TYPE_KEYS[type]);
  const [txPage, setTxPage] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalTxId, setModalTxId] = useState<string | null>(null);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const fetchTxns = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/party/transactions?page=${page}&pageSize=${pageSize}`,
          { credentials: "include" },
        );
        if (res.ok) setTxPage((await res.json()) as TxPage);
        else
          setTxPage({ items: [], total: 0, page, pageSize, totalPages: 0 });
      } catch {
        setTxPage({ items: [], total: 0, page, pageSize, totalPages: 0 });
      } finally {
        setLoading(false);
      }
    },
    [pageSize],
  );

  useEffect(() => {
    void fetchTxns(currentPage);
  }, [fetchTxns, currentPage, refreshKey]);

  function changePage(p: number) {
    setCurrentPage(p);
    void fetchTxns(p);
  }

  function refresh() {
    void fetchTxns(currentPage);
  }

  async function cancelOffer(tx: TxItem) {
    const offerContractId = tx.ledgerTxId;
    if (!offerContractId) return;

    const confirmed = window.confirm(
      `Withdraw this transfer offer?\n\n` +
        `${Math.abs(Number(tx.amountMicroCc)) / 1_000_000} CC will be refunded to your wallet.\n` +
        `Platform fee (if any) is NOT refundable.\n\n` +
        `Offer ID: ${offerContractId.slice(0, 20)}…`,
    );
    if (!confirmed) return;

    setCancellingIds((prev) => new Set(prev).add(tx.id));
    try {
      const res = await fetch("/api/party/cancel-transfer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerContractId }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      if (res.ok && data.success) {
        alert(data.message ?? "Transfer cancelled. CC refunded.");
        refresh();
      } else {
        alert(data.message ?? "Failed to cancel. The offer may have already been accepted or expired.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
    }
  }

  return (
    <div className={cn(embedded ? "" : "space-y-8", className)}>
      {!embedded ? (
        <h2 className="text-2xl font-bold text-slate-100">CC Transaction log</h2>
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
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.counterparty")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.ledgerTx")}</th>
                    <th className="whitespace-nowrap px-5 py-3.5 sm:px-6 sm:py-4 font-semibold">{t("transactions.when")}</th>
                  </tr>
                </thead>
                <tbody>
                  {txPage.items.map((tx) => {
                    const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
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
                        onClick={() => setModalTxId(tx.id)}
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
                              {txDisplayTitle(tx, txLabel(tx.type))}
                            </span>
                          </div>
                        </td>
                        <td
                          className={cn(
                            "px-5 py-3.5 sm:px-6 sm:py-4 text-base font-bold tabular-nums",
                            amountColor(tx.type),
                          )}
                        >
                          {amountSign(tx.type)}
                          {ccAmt.toFixed(4)} CC
                        </td>
                        <td className="max-w-[12rem] truncate px-5 py-3.5 sm:px-6 sm:py-4 text-sm font-medium text-slate-400">
                          {tx.description}
                        </td>
                        <td className="max-w-[10rem] truncate px-5 py-3.5 sm:px-6 sm:py-4 font-mono text-sm font-medium text-slate-400">
                          {tx.counterparty ?? tx.referenceId ?? "\u2014"}
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
                        <td className="whitespace-nowrap px-3 py-3.5 sm:px-4 sm:py-4">
                          {tx.type === "TRANSFER_OUT" &&
                            tx.description.includes("[pending acceptance") &&
                            tx.ledgerTxId ? (
                            <button
                              type="button"
                              disabled={cancellingIds.has(tx.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void cancelOffer(tx);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                            >
                              {cancellingIds.has(tx.id) ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-white/[0.04] md:hidden">
              {txPage.items.map((tx) => {
                const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
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
                      onClick={() => setModalTxId(tx.id)}
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
                          {txDisplayTitle(tx, tx.description)}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-400">{date}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            amountColor(tx.type),
                          )}
                        >
                          {amountSign(tx.type)}
                          {ccAmt.toFixed(4)} CC
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-400">
                          {txLabel(tx.type)}
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

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        open={modalTxId !== null}
        transactionId={modalTxId}
        onClose={() => setModalTxId(null)}
      />
    </div>
  );
}