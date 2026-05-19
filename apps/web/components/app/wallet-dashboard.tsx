"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/copy-field";
import { WalletActions } from "@/components/app/wallet-actions";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface TxItem {
  id: string;
  amountMicroCc: string;
  type: string;
  description: string;
  counterparty: string | null;
  referenceId: string | null;
  createdAt: string;
}

interface TxPage {
  items: TxItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface WalletDashboardProps {
  me: { username?: string | null; cantonPartyId?: string | null };
  onRefresh: () => void;
}

const PAGE_SIZE = 5;


export function WalletDashboard({ me, onRefresh }: WalletDashboardProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [ccUsdPrice, setCcUsdPrice] = useState(0);
  const [txPage, setTxPage] = useState<TxPage | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/party/balance", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { balance?: number | null };
        setBalance(data.balance ?? 0);
      }
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const fetchTxns = useCallback(async (page: number) => {
    setTxLoading(true);
    try {
      const res = await fetch(
        `/api/party/transactions?page=${page}&pageSize=${PAGE_SIZE}`,
        { credentials: "include" },
      );
      if (res.ok) setTxPage((await res.json()) as TxPage);
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => { void fetchBalance(); }, [fetchBalance]);
  useEffect(() => { void fetchTxns(currentPage); }, [fetchTxns, currentPage]);
  useEffect(() => {
    fetch("/api/party/fee-config", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { ccUsdPrice?: number } | null) => { if (d?.ccUsdPrice) setCcUsdPrice(d.ccUsdPrice); })
      .catch(() => {});
  }, []);

  const handleBalanceRefresh = useCallback(() => {
    void fetchBalance();
    void fetchTxns(currentPage);
  }, [fetchBalance, fetchTxns, currentPage]);

  return (
    <div className="space-y-6">
      {/* Identity card */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Wallet Active
          </p>
        </div>
        {me.cantonPartyId && (
          <div className="mt-3">
            <CopyField label="Canton Party ID" value={me.cantonPartyId} />
          </div>
        )}
      </div>

      {/* Balance */}
      <div className="glass-card rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Balance
          </p>
          <button
            onClick={fetchBalance}
            disabled={balanceLoading}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
            aria-label="Refresh balance"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${balanceLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tabular-nums">
          {balanceLoading ? (
            <span className="text-[var(--muted-foreground)]">—</span>
          ) : (
            <>
              {balance?.toFixed(4) ?? "0.0000"}{" "}
              <span className="text-lg font-normal text-[var(--muted-foreground)]">CC</span>
            </>
          )}
        </p>
        {!balanceLoading && ccUsdPrice > 0 && balance !== null && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            ≈ ${(balance * ccUsdPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </p>
        )}
      </div>

      {/* Send / Receive */}
      <WalletActions partyId={me.cantonPartyId ?? ""} onBalanceRefresh={handleBalanceRefresh} />

      {/* Transaction History */}
      <div className="glass-card rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <p className="text-sm font-semibold text-[var(--foreground)]">Transaction History</p>
          <button
            onClick={() => { setCurrentPage(1); void fetchTxns(1); }}
            disabled={txLoading}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
            aria-label="Refresh transactions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${txLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {txLoading ? (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">No transactions yet.</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]/70">
              Send or receive CC to see your history here.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[var(--border)]">
              {txPage.items.map((tx) => {
                const isOut = tx.type === "TRANSFER_OUT";
                const ccAmt = Math.abs(Number(tx.amountMicroCc) / 1_000_000);
                const sign = isOut ? "-" : "+";
                const color = isOut ? "text-red-500" : "text-green-500";
                const bgColor = isOut ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500";
                const usdAmt = ccUsdPrice > 0 ? (ccAmt * ccUsdPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
                const party = tx.counterparty ?? tx.referenceId;
                const date = new Date(tx.createdAt).toLocaleString("en-GB", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                });

                return (
                  <li key={tx.id} className="flex items-center gap-4 px-5 py-4">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", bgColor)}>
                      {isOut ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {isOut ? "To" : "From"}: <span className="font-semibold">{party ?? "—"}</span>
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">{date}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("font-[family-name:var(--font-space)] text-sm font-semibold tabular-nums", color)}>
                        {sign}{ccAmt.toFixed(4)} CC
                      </p>
                      {usdAmt && (
                        <p className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                          ≈ {sign}${usdAmt}
                        </p>
                      )}
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
                    onClick={() => { const p = currentPage - 1; setCurrentPage(p); void fetchTxns(p); }}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-7 w-7 p-0 disabled:opacity-40")}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    disabled={currentPage >= txPage.totalPages}
                    onClick={() => { const p = currentPage + 1; setCurrentPage(p); void fetchTxns(p); }}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-7 w-7 p-0 disabled:opacity-40")}
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
