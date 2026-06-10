"use client";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowUpRight, Gift, RefreshCw, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export const TRANSACTIONS_PAGE_SIZE = 5;

export interface TxItem { id: string; amountMicroCc: string; type: "QUEST_REWARD" | "SPIN_REWARD" | "TRANSFER_IN" | "TRANSFER_OUT" | "AIRDROP"; description: string; referenceId: string | null; counterparty?: string | null; ledgerTxId: string | null; cantonUpdateId?: string | null; settledAt: string | null; createdAt: string; }
interface TxPage { items: TxItem[]; total: number; page: number; pageSize: number; totalPages: number; }

const TX_TYPE_KEYS: Record<TxItem["type"], string> = { QUEST_REWARD: "transactions.questReward", SPIN_REWARD: "transactions.spinReward", TRANSFER_IN: "transactions.receivedCc", TRANSFER_OUT: "transactions.sentCc", AIRDROP: "transactions.airdrop" };

function TxTypeIcon({ type }: { type: TxItem["type"] }) { switch (type) { case "TRANSFER_OUT": return <ArrowUpRight className="h-4 w-4" />; case "TRANSFER_IN": return <ArrowDownLeft className="h-4 w-4" />; case "QUEST_REWARD": case "SPIN_REWARD": case "AIRDROP": return <Gift className="h-4 w-4" />; default: return <Zap className="h-4 w-4" />; } }
function txIconBg(type: TxItem["type"]): string { switch (type) { case "TRANSFER_OUT": return "bg-red-500/10 text-red-500"; case "TRANSFER_IN": return "bg-green-500/10 text-green-500"; case "QUEST_REWARD": return "bg-[var(--primary)]/15 text-[var(--foreground)]"; case "SPIN_REWARD": case "AIRDROP": return "bg-purple-500/10 text-purple-500"; default: return "bg-blue-500/10 text-blue-500"; } }
function ac(type: TxItem["type"]): string { return type === "TRANSFER_OUT" ? "text-red-500" : "text-green-500"; }
function as(type: TxItem["type"]): string { return type === "TRANSFER_OUT" ? "\u2212" : "+"; }
function tdt(tx: TxItem, fb: string): string { const d = tx.description?.trim() ?? ""; return d.startsWith("Sent ") || d.startsWith("Received ") ? d : fb; }

type Props = { variant?: "page" | "embedded"; pageSize?: number; refreshKey?: number; className?: string; };
export function TransactionsView({ variant = "page", pageSize = TRANSACTIONS_PAGE_SIZE, refreshKey = 0, className }: Props) {
  const t = usePlatformT(); const embedded = variant === "embedded";
  const tl = (type: TxItem["type"]) => t(TX_TYPE_KEYS[type]);
  const [tp, setTp] = useState<TxPage | null>(null); const [l, setL] = useState(true);
  const [cp, setCp] = useState(1); const [mId, setMId] = useState<string | null>(null);

  const f = useCallback(async (p: number) => { setL(true);
    try { const r = await fetch(`/api/party/transactions?page=${p}&pageSize=${pageSize}`, { credentials: "include" }); if (r.ok) setTp(await r.json() as TxPage); else setTp({ items: [], total: 0, page: p, pageSize, totalPages: 0 }); }
    catch { setTp({ items: [], total: 0, page: p, pageSize, totalPages: 0 }); } finally { setL(false); } }, [pageSize]);
  useEffect(() => { void f(cp); }, [f, cp, refreshKey]);

  return (<div className={cn(embedded ? "" : "space-y-6", className)}>
    {!embedded && <h2 className="text-xl font-bold text-[var(--foreground)]">Transaction Log</h2>}
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-5"><p className="text-sm font-semibold text-[var(--foreground)]">{t("transactions.title")}</p><button type="button" onClick={() => void f(cp)} disabled={l} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">{l ? <LoadingSpinner size="sm" /> : "Refresh"}</button></div>
      {l ? <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      : !tp || tp.items.length === 0 ? <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">{t("transactions.empty")}</div>
      : <>
        <table className="w-full text-left hidden md:table"><thead className="text-xs font-semibold uppercase text-[var(--muted-foreground)]"><tr><th className="px-4 py-3 md:px-5">Type</th><th className="px-4 py-3 md:px-5">Amount</th><th className="px-4 py-3 md:px-5">Description</th><th className="px-4 py-3 md:px-5">Counterparty</th><th className="px-4 py-3 md:px-5">TX</th><th className="px-4 py-3 text-right md:px-5">Date</th></tr></thead>
        <tbody>{tp.items.map(tx => { const ca = Math.abs(Number(tx.amountMicroCc)) / 1_000_000; const d = new Date(tx.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          return <tr key={tx.id} className="border-t border-[var(--border)] cursor-pointer hover:bg-[var(--muted)]/50 transition-colors" onClick={() => setMId(tx.id)}>
            <td className="px-4 py-3 md:px-5"><span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", txIconBg(tx.type))}><TxTypeIcon type={tx.type} /></span></td>
            <td className={cn("px-4 py-3 md:px-5 text-sm font-bold tabular-nums", ac(tx.type))}>{as(tx.type)}{ca.toFixed(4)}</td>
            <td className="px-4 py-3 md:px-5 text-sm text-[var(--muted-foreground)] max-w-[12rem] truncate">{tx.description}</td>
            <td className="px-4 py-3 md:px-5 text-sm font-mono text-[var(--muted-foreground)] max-w-[10rem] truncate">{tx.counterparty ?? tx.referenceId ?? "\u2014"}</td>
            <td className="px-4 py-3 md:px-5"><span className="text-xs font-mono text-[var(--primary)]">{tx.cantonUpdateId ? `${tx.cantonUpdateId.slice(0,10)}\u2026` : tx.ledgerTxId ? `${tx.ledgerTxId.slice(0,10)}\u2026` : "View"}</span></td>
            <td className="px-4 py-3 md:px-5 text-xs text-[var(--muted-foreground)] text-right">{d}</td></tr>; })}
        </tbody></table>
        <ul className="divide-y divide-[var(--border)] md:hidden">{tp.items.map(tx => { const ca = Math.abs(Number(tx.amountMicroCc)) / 1_000_000; const d = new Date(tx.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          return <li key={tx.id}><button type="button" onClick={() => setMId(tx.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--muted)]/50 transition-colors">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", txIconBg(tx.type))}><TxTypeIcon type={tx.type} /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--foreground)] truncate">{tdt(tx, tx.description)}</p><p className="text-xs text-[var(--muted-foreground)]">{d}</p></div>
            <div className="shrink-0 text-right"><p className={cn("text-sm font-bold tabular-nums", ac(tx.type))}>{as(tx.type)}{ca.toFixed(4)}</p><p className="text-xs text-[var(--muted-foreground)]">{tl(tx.type)}</p></div>
          </button></li>; })}
        </ul>
        <ListPagination className="px-4 py-3" page={cp} totalPages={tp.totalPages} total={tp.total} disabled={l} onPageChange={p => { setCp(p); void f(p); }} />
      </>}
    </div>
    <TransactionDetailModal open={mId !== null} transactionId={mId} onClose={() => setMId(null)} />
  </div>);
}