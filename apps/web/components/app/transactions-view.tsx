"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/app/list-pagination";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
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
  return type === "TRANSFER_OUT" ? "−" : "+";
}

type TransactionsViewProps = {
  /** Full page with section header, or compact block inside wallet */
  variant?: "page" | "embedded";
  pageSize?: number;
  /** Increment to refetch after send/receive */
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

  return (
    <div className={cn(embedded ? "" : "space-y-6", className)}>
      {!embedded ? (
        <h2 className="type-page-title">CC Transaction log</h2>
      ) : null}

      <div
        className={cn(
          "w-full min-w-0 overflow-hidden rounded-2xl border border-[var(--border)]",
          embedded ? "glass-card" : "bg-[var(--card)]",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {t("transactions.title")}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
            aria-label="Refresh transactions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div
            className={cn(
              "flex items-center justify-center",
              embedded ? "py-10" : "py-16",
            )}
          >
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className={cn("text-center", embedded ? "py-10" : "py-16")}>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {t("transactions.empty")}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Complete quests or send/receive CC to see activity here.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden min-w-0 md:block">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.type")}</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.amount")}</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.description")}</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.counterparty")}</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.ledgerTx")}</th>
                    <th className="whitespace-nowrap px-5 py-3 font-medium">{t("transactions.when")}</th>
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
                            <span className="font-medium">{txLabel(tx.type)}</span>
                          </div>
                        </td>
                        <td
                          className={cn(
                            "type-display px-5 py-3 text-sm font-semibold tabular-nums",
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
                          <Link
                            href={`/transactions/${tx.id}`}
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/60 px-2 py-0.5 font-mono text-[10px] text-[var(--primary)] underline-offset-2 hover:underline"
                          >
                            {tx.cantonUpdateId
                              ? `${tx.cantonUpdateId.slice(0, 10)}…`
                              : tx.ledgerTxId
                                ? `${tx.ledgerTxId.slice(0, 10)}…`
                                : "View"}
                          </Link>
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
                  <li key={tx.id}>
                    <Link
                      href={`/transactions/${tx.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--muted)]/40"
                    >
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
                          "type-display text-sm font-semibold tabular-nums",
                          amountColor(tx.type),
                        )}
                      >
                        {amountSign(tx.type)}
                        {ccAmt.toFixed(4)} CC
                      </p>
                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        {txLabel(tx.type)}
                      </p>
                    </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <ListPagination
              className="px-5 pb-3"
              page={currentPage}
              totalPages={txPage.totalPages}
              total={txPage.total}
              disabled={loading}
              onPageChange={changePage}
            />
          </>
        )}
      </div>
    </div>
  );
}
