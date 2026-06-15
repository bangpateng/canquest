"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowUpRight, Gift, RefreshCw, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export const TRANSACTIONS_PAGE_SIZE = 5;
/** Server-side proxy to avoid CORS — see apps/web/app/api/lighthouse/[...path]/route.ts */
const LIGHTHOUSE_PROXY = "/api/lighthouse";

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
  /** On-chain source marker */
  source?: "db" | "onchain";
}

/** Generic on-chain item from Lighthouse — fields vary per endpoint */
interface LighthouseOnChainItem {
  id: number;
  sender?: string;
  receiver?: string;
  amount?: string;
  amount_cc?: string;
  created_at?: string;
  timestamp?: string;
  update_id?: string;
  contract_id?: string;
  type?: string;
  description?: string;
  kind?: string;
  counterparty?: string;
  party_id?: string;
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
  /** Canton party ID for on-chain lookup (5N Lighthouse). If empty, skip on-chain. */
  partyId?: string | null;
};

/** Resolve tx type from on-chain item fields */
function inferOnChainType(item: LighthouseOnChainItem, partyId: string): "TRANSFER_IN" | "TRANSFER_OUT" | "QUEST_REWARD" | "SPIN_REWARD" | "AIRDROP" {
  const kind = (item.kind ?? item.type ?? "").toLowerCase();

  if (kind.includes("reward") || kind.includes("quest")) return "QUEST_REWARD";
  if (kind.includes("spin") || kind.includes("wheel")) return "SPIN_REWARD";
  if (kind.includes("airdrop") || kind.includes("claim")) return "AIRDROP";

  // Transfer detection by sender/receiver
  if (item.sender && item.receiver) {
    return item.sender === partyId ? "TRANSFER_OUT" : "TRANSFER_IN";
  }

  // Fallback: check negative amounts
  const amountStr = item.amount ?? item.amount_cc ?? "0";
  const amount = Number(amountStr);
  if (amount < 0) return "TRANSFER_OUT";
  return "TRANSFER_IN";
}

/** Build description from on-chain item */
function inferOnChainDescription(item: LighthouseOnChainItem, type: TxItem["type"]): string {
  if (item.description?.trim()) return item.description;

  const counterparty = item.counterparty ?? item.receiver ?? item.sender ?? "";
  const short = counterparty.split("::")[0] ?? counterparty.slice(0, 12);

  switch (type) {
    case "TRANSFER_OUT":
      return `Sent to ${short}…`;
    case "TRANSFER_IN":
      return `Received from ${short}…`;
    case "QUEST_REWARD":
      return "Quest reward";
    case "SPIN_REWARD":
      return "Spin reward";
    case "AIRDROP":
      return "Airdrop";
    default:
      return "On-chain transaction";
  }
}

/** Convert a Lighthouse on-chain item to TxItem */
function lighthouseToTxItem(
  item: LighthouseOnChainItem,
  partyId: string,
): TxItem {
  const type = inferOnChainType(item, partyId);
  const amountStr = item.amount ?? item.amount_cc ?? "0";
  const amount = Math.abs(Number(amountStr));
  const timestamp = item.created_at ?? item.timestamp ?? new Date().toISOString();
  const description = inferOnChainDescription(item, type);
  const counterparty = item.counterparty
    ?? item.receiver
    ?? item.sender
    ?? null;

  return {
    id: `lh-${item.id}`,
    amountMicroCc: String(Math.round(amount * 1_000_000)),
    type,
    description,
    referenceId: null,
    counterparty,
    ledgerTxId: item.contract_id ?? null,
    cantonUpdateId: item.update_id ?? null,
    settledAt: timestamp,
    createdAt: timestamp,
    source: "onchain" as const,
  };
}

/** Fetch on-chain items from a Lighthouse endpoint, convert to TxItem[] */
async function fetchLighthouseEndpoint(
  url: string,
  partyId: string,
): Promise<TxItem[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();

    // Response bisa berupa array langsung atau { items: [...], data: [...] }
    const items: LighthouseOnChainItem[] = Array.isArray(data)
      ? data
      : (data.items ?? data.data ?? data.transactions ?? data.rewards ?? data.transfers ?? []);

    return items.map((item) => lighthouseToTxItem(item, partyId));
  } catch {
    return [];
  }
}

export function TransactionsView({
  variant = "page",
  pageSize = TRANSACTIONS_PAGE_SIZE,
  refreshKey = 0,
  className,
  partyId,
}: TransactionsViewProps) {
  const t = usePlatformT();
  const embedded = variant === "embedded";
  const txLabel = (type: TxItem["type"]) => t(TX_TYPE_KEYS[type]);
  const [txPage, setTxPage] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalTxId, setModalTxId] = useState<string | null>(null);

  const fetchTxns = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        // Fetch from DB + 3 Lighthouse endpoints in parallel
        const dbPromise = fetch(
          `/api/party/transactions?page=${page}&pageSize=${pageSize}`,
          { credentials: "include" },
        );

        const onChainPromises: Promise<TxItem[]>[] = [];
        if (partyId) {
          const encoded = encodeURIComponent(partyId);
          onChainPromises.push(
            fetchLighthouseEndpoint(
              `${LIGHTHOUSE_PROXY}/parties/${encoded}/tx?limit=${pageSize * 3}`,
              partyId,
            ),
            fetchLighthouseEndpoint(
              `${LIGHTHOUSE_PROXY}/parties/${encoded}/transfers?limit=${pageSize * 3}`,
              partyId,
            ),
            fetchLighthouseEndpoint(
              `${LIGHTHOUSE_PROXY}/parties/${encoded}/rewards?limit=${pageSize * 3}`,
              partyId,
            ),
          );
        }

        const [dbRes, ...onChainResults] = await Promise.allSettled([
          dbPromise,
          ...onChainPromises,
        ]);

        // Parse DB results
        let dbPage: TxPage = { items: [], total: 0, page, pageSize, totalPages: 0 };
        if (dbRes.status === "fulfilled" && dbRes.value.ok) {
          dbPage = (await dbRes.value.json()) as TxPage;
        }

        // Collect all on-chain items (deduped)
        const seenContractIds = new Set(
          dbPage.items
            .map((x) => x.cantonUpdateId ?? x.ledgerTxId)
            .filter(Boolean),
        );
        const onChainItems: TxItem[] = [];

        for (const result of onChainResults) {
          if (result.status !== "fulfilled") continue;
          for (const item of result.value) {
            const key = item.cantonUpdateId ?? item.ledgerTxId;
            if (key && seenContractIds.has(key)) continue;
            if (key) seenContractIds.add(key);
            onChainItems.push(item);
          }
        }

        // Merge: DB first, then on-chain
        const merged = [...dbPage.items, ...onChainItems];

        // Sort by createdAt descending, slice to pageSize
        merged.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const paged = merged.slice(0, pageSize);

        setTxPage({
          items: paged,
          total: merged.length,
          page,
          pageSize,
          totalPages: Math.ceil(merged.length / pageSize),
        });
      } catch {
        setTxPage({ items: [], total: 0, page, pageSize, totalPages: 0 });
      } finally {
        setLoading(false);
      }
    },
    [pageSize, partyId],
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