"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Handshake,
  Lock,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Unlock,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Quest } from "@/lib/quest/quest-types";
import { ROUTES } from "@/lib/routing/app-routes";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";

/**
 * Overview widgets — modul tambahan halaman Overview.
 *
 * Sumber data SEMUA sudah ada (tidak ada endpoint baru):
 * - LiveCampaignsStrip → GET /api/quests (sama dengan quests-browser)
 * - RecentActivityFeed → GET /api/party/transactions (sama dengan Activity)
 *
 * Keduanya "optional widgets": saat data kosong/gagal (mis. user belum punya
 * wallet → 401/403), widget disembunyikan — Overview tetap tampil normal.
 */

/** "2d 14h" / "14h 5m" / "5m" — sisa waktu menuju endsAt, refresh tiap 60s. */
function useTimeLeft(endsAt: string | null | undefined): string | null {
  const compute = useCallback(() => {
    if (!endsAt) return null;
    const diff = new Date(endsAt).getTime() - Date.now();
    if (diff <= 0) return null;
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }, [endsAt]);

  const [label, setLabel] = useState<string | null>(compute);

  useEffect(() => {
    setLabel(compute());
    const id = setInterval(() => setLabel(compute()), 60_000);
    return () => clearInterval(id);
  }, [compute]);

  return label;
}

function CampaignRow({ quest }: { quest: Quest }) {
  const timeLeft = useTimeLeft(quest.endsAt);
  const urgent = quest.endsAt
    ? new Date(quest.endsAt).getTime() - Date.now() < 24 * 3_600_000
    : false;

  return (
    <Link
      href={ROUTES.campaignQuest(quest.id, quest.title)}
      className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[var(--primary)]/5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-canton-subtle text-xs font-bold uppercase text-canton">
        {quest.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          quest.orgSlug.slice(0, 2).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--foreground)]">
          {quest.title}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs font-medium",
            urgent ? "text-red-600" : "text-[var(--muted-foreground)]",
          )}
        >
          {timeLeft ? `Ends in ${timeLeft}` : "Closing"}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-colors group-hover:text-canton" />
    </Link>
  );
}

/** Strip kampanye partner yang sedang aktif, diurut dari yang paling cepat berakhir. */
export function LiveCampaignsStrip() {
  const [quests, setQuests] = useState<Quest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quests", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return [];
        const data = (await r.json().catch(() => [])) as Quest[] | { message?: string };
        return Array.isArray(data) ? data : [];
      })
      .then((all) => {
        if (cancelled) return;
        setQuests(
          all
            .filter(
              (q) =>
                q.status === "ACTIVE" &&
                q.questKind === "CAMPAIGN" &&
                q.endsAt &&
                new Date(q.endsAt).getTime() > Date.now(),
            )
            .sort(
              (a, b) =>
                new Date(a.endsAt ?? 0).getTime() - new Date(b.endsAt ?? 0).getTime(),
            )
            .slice(0, 3),
        );
      })
      .catch(() => {
        if (!cancelled) setQuests([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (quests === null) {
    // Skeleton — bentuk sama dengan konten supaya layout tidak melompat.
    return (
      <Card className="p-5">
        <div className="mb-3 h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--muted)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--muted)]" />
                <div className="h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (quests.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between px-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Sparkles className="h-4 w-4 text-canton" aria-hidden />
          Live campaigns
        </h3>
        <Link
          href={ROUTES.campaignQuests}
          className="text-xs font-semibold text-canton hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="space-y-0.5">
        {quests.map((q) => (
          <CampaignRow key={q.id} quest={q} />
        ))}
      </div>
    </Card>
  );
}

/** ── Recent activity ──────────────────────────────────────────────────── */

type TxLike = {
  id: string;
  type: string;
  description: string | null;
  createdAt: string;
};

function txIcon(type: string): { icon: LucideIcon; tone: "in" | "out" | "neutral" } {
  if (/(TRANSFER_IN|TOKEN_TRANSFER_IN|AIRDROP|QUEST_REWARD|SPIN_REWARD|SWAP_IN)$/.test(type)) {
    return { icon: ArrowDownLeft, tone: "in" };
  }
  if (/(TRANSFER_OUT|TOKEN_TRANSFER_OUT|SWAP_OUT)$/.test(type)) {
    return { icon: ArrowUpRight, tone: "out" };
  }
  if (type === "CC_LOCK") return { icon: Lock, tone: "neutral" };
  if (type === "CC_UNLOCK") return { icon: Unlock, tone: "neutral" };
  if (/^SWAP/.test(type)) return { icon: Repeat2, tone: "neutral" };
  if (/^OFFER/.test(type)) return { icon: Handshake, tone: "neutral" };
  if (/^PREAPPROVAL/.test(type)) return { icon: ShieldCheck, tone: "neutral" };
  if (type === "OFFER_REJECTED" || type === "TOKEN_OFFER_REJECTED") {
    return { icon: XCircle, tone: "out" };
  }
  return { icon: Activity, tone: "neutral" };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const FALLBACK_LABEL: Record<string, string> = {
  CC_LOCK: "Locked CC",
  CC_UNLOCK: "Unlocked CC",
  QUEST_REWARD: "Quest reward",
  SPIN_REWARD: "Spin reward",
  AIRDROP: "Airdrop",
  SWAP_OUT: "Swap sent",
  SWAP_IN: "Swap received",
};

/** Feed 5 transaksi terakhir — hanya saat user sudah punya wallet. */
export function RecentActivityFeed({ hasWallet }: { hasWallet: boolean }) {
  const [items, setItems] = useState<TxLike[] | null>(null);

  useEffect(() => {
    if (!hasWallet) return;
    let cancelled = false;
    fetch("/api/party/transactions?page=1&pageSize=5", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return { items: [] as TxLike[] };
        return (await r.json().catch(() => ({ items: [] }))) as { items?: TxLike[] };
      })
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasWallet]);

  if (!hasWallet || items === null || items.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <Activity className="h-4 w-4 text-canton" aria-hidden />
          Recent activity
        </h3>
        <Link href="/activity" className="text-xs font-semibold text-canton hover:underline">
          View all
        </Link>
      </div>
      <div className="space-y-0.5">
        {items.map((tx) => {
          const { icon: Icon, tone } = txIcon(tx.type);
          return (
            <Link
              key={tx.id}
              href={`/activity/${tx.id}`}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-[var(--primary)]/5"
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                  tone === "in"
                    ? "bg-canton-subtle text-canton"
                    : tone === "out"
                      ? "bg-[var(--muted)] text-[var(--foreground)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)]",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                  {tx.description?.trim() || FALLBACK_LABEL[tx.type] || tx.type.replaceAll("_", " ").toLowerCase()}
                </span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {relativeTime(tx.createdAt)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-colors group-hover:text-canton" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

/** Bar aksi cepat — pintasan ke fungsi yang paling sering dipakai. */
export const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/wallet", label: "Send", icon: ArrowUpRight },
  { href: "/wallet", label: "Swap", icon: ArrowLeftRight },
  { href: "/wallet", label: "Lock", icon: Lock },
  { href: ROUTES.campaignQuests, label: "Earn", icon: Sparkles },
];
