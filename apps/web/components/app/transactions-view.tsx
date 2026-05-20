"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Gift,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";

interface TxItem {
  id: string;
  amountMicroCc: string;
  type: "QUEST_REWARD" | "SPIN_REWARD" | "TRANSFER_IN" | "TRANSFER_OUT" | "AIRDROP";
  description: string;
  referenceId: string | null;
  counterparty?: string | null;
  ledgerTxId: string | null;
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

const PAGE_SIZE = 10;

const TX_TYPE_LABEL: Record<TxItem["type"], string> = {
  QUEST_REWARD: "Quest reward",
  SPIN_REWARD: "Spin reward",
  TRANSFER_IN: "Received CC",
  TRANSFER_OUT: "Sent CC",
  AIRDROP: "Airdrop",
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
  return type === "TRANSFER_OUT" ? "−" : "+";
}

export function TransactionsView() {
  const [txPage, setTxPage] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchTxns = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/party/transactions?page=${page}&pageSize=${PAGE_SIZE}`,
        { credentials: "include" },
      );
      if (res.ok) setTxPage((await res.json()) as TxPage);
      else setTxPage({ items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 0 });
    } catch {
      setTxPage({ items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTxns(currentPage);
  }, [fetchTxns, currentPage]);

  function changePage(p: number) {
    setCurrentPage(p);
    void fetchTxns(p);
  }

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          History
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          CC Transaction log
        </h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          All Canton Coin movements including quest rewards, transfers and airdrops.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {txPage ? `${txPage.total} transactions` : "Transactions"}
          </p>
          <button
            onClick={() => void fetchTxns(currentPage)}
            disabled={loading}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">
              No transactions yet
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Complete quests or send/receive CC to see activity here.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">Type</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">Amount</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">Description</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">Counterparty</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">Ledger TX</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {txPage.items.map((tx) => {
                    const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
                    const date = new Date(tx.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <tr
                        key={tx.id}
                        className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/40"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-lg",
                                txIconBg(tx.type),
                              )}
                            >
                              <TxTypeIcon type={tx.type} />
                            </span>
                            <span className="font-medium">{TX_TYPE_LABEL[tx.type]}</span>
                          </div>
                        </td>
                        <td
                          className={cn(
                            "px-5 py-3 font-[family-name:var(--font-space)] font-semibold tabular-nums",
                            amountColor(tx.type),
                          )}
                        >
                          {amountSign(tx.type)}
                          {ccAmt.toFixed(4)} CC
                        </td>
                        <td className="max-w-[12rem] truncate px-5 py-3 text-[var(--muted-foreground)]">
                          {tx.description}
                        </td>
                        <td className="max-w-[10rem] truncate px-5 py-3 font-mono text-xs text-[var(--muted-foreground)]">
                          {tx.counterparty ?? tx.referenceId ?? "—"}
                        </td>
                        <td className="px-5 py-3">
                          {tx.ledgerTxId ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/60 px-2 py-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">
                              {tx.ledgerTxId.slice(0, 12)}…
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-[var(--muted-foreground)]">
                          {date}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-[var(--border)] md:hidden">
              {txPage.items.map((tx) => {
                const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
                const date = new Date(tx.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <li key={tx.id} className="flex items-center gap-4 px-5 py-4">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        txIconBg(tx.type),
                      )}
                    >
                      <TxTypeIcon type={tx.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {tx.description}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">{date}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "font-[family-name:var(--font-space)] text-sm font-semibold tabular-nums",
                          amountColor(tx.type),
                        )}
                      >
                        {amountSign(tx.type)}
                        {ccAmt.toFixed(4)} CC
                      </p>
                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        {TX_TYPE_LABEL[tx.type]}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Pagination */}
            {txPage.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
                <p className="text-xs text-[var(--muted-foreground)]">
                  Page {txPage.page} of {txPage.totalPages} · {txPage.total} total
                </p>
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() => changePage(currentPage - 1)}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "h-7 w-7 p-0 disabled:opacity-40",
                    )}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    disabled={currentPage >= txPage.totalPages}
                    onClick={() => changePage(currentPage + 1)}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "h-7 w-7 p-0 disabled:opacity-40",
                    )}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
