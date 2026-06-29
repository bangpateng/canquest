"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { ArrowDownLeft, ArrowUpRight, Ban, Gift, Lock, LockOpen, RefreshCw, ShieldCheck, ShieldOff, Undo2, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export const TRANSACTIONS_PAGE_SIZE = 5;
/** Server-side proxy to onchain tx — partyId comes from JWT on the backend. */
const LIGHTHOUSE_PROXY = "/api/party/transactions/onchain";
/** Server-side proxy to DB transactions — source of truth (fee filtered, lock/unlock recorded). */
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
  /** Lighthouse event id (format "122072…:0") — used for the explorer link. */
  eventId?: string | null;
  /** Lighthouse explorer link for this on-chain item (injected by backend). */
  cantonScanUrl?: string | null;
  /** Network fee paid, in microCC. */
  networkFeeMicroCc?: string | null;
  /** Canton round number the transaction settled in. */
  round?: number | string | null;
  /** Estimated USD value of the amount, if known. */
  usdEstimate?: number | null;
}



/** Generic on-chain item from Lighthouse — fields vary per endpoint */
interface LighthouseOnChainItem {
  id: number;
  sender?: string;
  receiver?: string;
  sender_address?: string;
  receiver_address?: string;
  event_id?: string;
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
  round?: number | string;
  fee?: string;
  fee_cc?: string;
  /** Network fee in microCC, injected by the backend from TRANSACTION_FEE_CC. */
  network_fee?: string;
  scan_url?: string;
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
  /** Canton party ID for on-chain lookup (5N Lighthouse). If empty, skip on-chain. */
  partyId?: string | null;
};

/** Resolve tx type from on-chain item fields */
function inferOnChainType(item: LighthouseOnChainItem, partyId: string): TxItem["type"] {
  const kind = (item.kind ?? item.type ?? "").toLowerCase();

  if (kind.includes("reward") || kind.includes("quest")) return "QUEST_REWARD";
  if (kind.includes("spin") || kind.includes("wheel")) return "SPIN_REWARD";
  if (kind.includes("airdrop") || kind.includes("claim")) return "AIRDROP";

  // Transfer detection by sender/receiver
  const sender = item.sender_address ?? item.sender;
  const receiver = item.receiver_address ?? item.receiver;
  if (sender && receiver) {
    return sender === partyId ? "TRANSFER_OUT" : "TRANSFER_IN";
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

  const counterparty = item.counterparty
    ?? item.receiver_address ?? item.sender_address
    ?? item.receiver ?? item.sender ?? "";
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

  // Keep the real sender/receiver addresses separate so the detail modal can
  // render From/To correctly (and tag only the matching one as "You").
  const senderAddress = item.sender_address ?? item.sender ?? null;
  const receiverAddress = item.receiver_address ?? item.receiver ?? null;

  // Network fee — backend injects network_fee (microCC). Fall back to fee/fee_cc
  // (CC), and finally to 0.2 CC (200000 microCC) so the receipt always shows it.
  let networkFeeMicroCc: string;
  if (item.network_fee != null && item.network_fee !== "") {
    networkFeeMicroCc = String(item.network_fee);
  } else {
    const feeStr = item.fee ?? item.fee_cc ?? null;
    networkFeeMicroCc =
      feeStr != null && feeStr !== "" && Number.isFinite(Number(feeStr))
        ? String(Math.round(Math.abs(Number(feeStr)) * 1_000_000))
        : "200000";
  }

  return {
    id: `lh-${item.id}`,
    amountMicroCc: String(Math.round(amount * 1_000_000)),
    type,
    description,
    referenceId: null,
    // List view keeps the counterparty column clean for on-chain items — the
    // description already says "Sent to …" / "Received from …".
    counterparty: null,
    ledgerTxId: item.contract_id ?? null,
    cantonUpdateId: item.update_id ?? item.event_id ?? null,
    settledAt: timestamp,
    createdAt: timestamp,
    source: "onchain" as const,
    partyId,
    senderAddress,
    receiverAddress,
    eventId: item.event_id ?? null,
    cantonScanUrl: item.scan_url ?? null,
    networkFeeMicroCc,
    round: item.round ?? null,
    usdEstimate: null,
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
      : (data.transfers ?? data.items ?? data.transactions ?? data.rewards ?? data.data ?? []);

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
  // Type column = arah transaksi yang ramah. Lock/unlock pakai label sendiri (bukan Sent/Received).
  const txDirection = (type: TxItem["type"]): string => {
    if (type === "CC_LOCK") return t(TX_TYPE_KEYS.CC_LOCK);
    if (type === "CC_UNLOCK") return t(TX_TYPE_KEYS.CC_UNLOCK);
    if (TOGGLE_TX_TYPES.has(type)) return t(TX_TYPE_KEYS[type]);
    return type === "TRANSFER_OUT" ? "Sent" : "Received";
  };
  const [txPage, setTxPage] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalTx, setModalTx] = useState<TxItem | null>(null);

  /** Polling 20s untuk history list — sinkron dengan bell notification.
   * Pause saat tab hidden untuk hemat resource; immediate refetch saat visible.
   * Pattern = use-transaction-notifications.ts. */
  const TX_POLL_MS = 20_000;


  const fetchTxns = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        if (!partyId) {
          setTxPage({ items: [], total: 0, page, pageSize, totalPages: 0 });
          return;
        }

        // ── DB adalah sumber utama (source of truth). ──────────────────────────
        // DB sudah benar: fee terfilter (server-side), CC_LOCK/CC_UNLOCK tercatat,
        // send/received ada. On-chain dipakai HANYA sebagai fallback untuk item yang
        // DB belum punya (transfer dari luar yang belum ter-sync), dengan dedup agar
        // tidak dobel.
        const dbRes = await fetch(
          `${DB_TRANSACTIONS_PROXY}?page=1&pageSize=200`,
          { credentials: "include", cache: "no-store" },
        ).catch(() => null);
        const dbData = dbRes?.ok ? ((await dbRes.json()) as { items?: TxItem[] }) : null;
        const dbItems: TxItem[] = (dbData?.items ?? []).map((tx) => ({
          ...tx,
          source: "db" as const,
        }));

        // ── On-chain fallback (fee sudah difilter di backend onchain proxy). ───
        const onchainItems = await fetchLighthouseEndpoint(
          `${LIGHTHOUSE_PROXY}?limit=200`,
          partyId,
        );

        // Dedup multi-key: kumpulkan SEMUA id di DB (ledgerTxId, cantonUpdateId,
        // transferInstructionCid) supaya item on-chain yang id-nya berbentuk beda
        // (contract_id vs update_id vs event_id) tetap bisa di-match dan tidak dobel.
        //
        // Penting: DB menyimpan Canton update_id ("1220…", tanpa ":N") sedangkan
        // on-chain event_id = "1220…:N". Keduanya adalah transaksi yang SAMA, jadi
        // kita normalisasi dengan menghapus suffix ":N" sebelum dibandingkan.
        const stripSuffix = (s: string): string =>
          s.replace(/:[0-9]+$/, "").trim();
        const dbKeys = new Set<string>();
        for (const tx of dbItems) {
          for (const k of [
            tx.ledgerTxId,
            tx.cantonUpdateId,
            tx.transferInstructionCid,
          ]) {
            const v = stripSuffix(k ?? "");
            if (v) dbKeys.add(v);
          }
        }
        const fallbackOnchain = onchainItems.filter((tx) => {
          // Cek semua kemungkinan key on-chain — cukup satu match untuk dianggap duplikat.
          const keys = [tx.ledgerTxId, tx.cantonUpdateId, tx.eventId]
            .map((k) => stripSuffix(k ?? ""))
            .filter(Boolean);
          if (keys.length === 0) return true; // tidak ada key → tidak bisa dedup → tetap masuk.
          return !keys.some((k) => dbKeys.has(k));
        });

        const all = [...dbItems, ...fallbackOnchain];
        all.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        const start = (page - 1) * pageSize;
        const paged = all.slice(start, start + pageSize);

        setTxPage({
          items: paged,
          total: all.length,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
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

  // ── Polling 20s + cross-surface sync ──────────────────────────────────────
  // History list harus realtime: (a) incoming transfer dari akun lain muncul
  // tanpa manual refresh, (b) bell notification sudah toast → list ikut refresh.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPoll = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(
        () => void fetchTxns(currentPage),
        TX_POLL_MS,
      );
    };
    const stopPoll = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    startPoll();

    // Refetch langsung saat tab kembali visible + restart interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchTxns(currentPage);
        startPoll();
      } else {
        stopPoll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Cross-surface sync: bell notification emit 'cc:new-tx' saat ada toast baru
    // → list langsung refetch (tanpa tunggu interval 20s berikutnya).
    const onNewTx = () => void fetchTxns(currentPage);
    window.addEventListener("cc:new-tx", onNewTx);

    return () => {
      stopPoll();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("cc:new-tx", onNewTx);
    };
  }, [fetchTxns, currentPage]);

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