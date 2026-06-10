"use client";
import { PageLoading } from "@/components/ui/loading-spinner";
import { EarnCampaignSkeleton } from "@/components/app/earn/earn-campaign-skeleton";
import { EarnCampaignCard } from "@/components/app/earn/earn-campaign-card";
import { QuestCard } from "@/components/app/quest/quest-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest/quest-types";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { resolveQuestMediaUrl } from "@/lib/quest/quest-media-url";

const PAGE_SIZE = 6;

function isWalletRequiredLoadError(m: string | null): boolean { return !m ? false : /canton wallet/i.test(m) || /wallet first/i.test(m); }

const TABS: { id: QuestStatus; label: string }[] = [
  { id: "ACTIVE", label: "Active" }, { id: "COMING_SOON", label: "Coming Soon" }, { id: "ENDED", label: "Ended" },
];

function normMedia(q: Quest): Quest { return { ...q, bannerImageUrl: resolveQuestMediaUrl(q.bannerImageUrl), logoUrl: resolveQuestMediaUrl(q.logoUrl) }; }

function matches(q: Quest, s: string) {
  const t = s.trim().toLowerCase(); if (!t) return true;
  return [q.title, q.org, q.description, q.rewardPool, q.deadline ?? "", ...q.tags].join(" ").toLowerCase().includes(t);
}

export function QuestsBrowser({ embedded = false, variant = "default" }: { embedded?: boolean; variant?: "default" | "earn" }) {
  const t = usePlatformT(); const isEarn = variant === "earn" || embedded;
  const [status, setStatus] = useState<QuestStatus>("ACTIVE");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<Quest[]>([]);
  const [prog, setProg] = useState<UserProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 30000); setLoading(true); setErr(null);
    Promise.all([
      fetch("/api/quests", { credentials: "include", signal: c.signal }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof d === "object" && d !== null && "message" in d && typeof (d as any).message === "string" ? (d as any).message : `Error ${r.status}`); return (Array.isArray(d) ? d : []).map(normMedia); }),
      fetch("/api/quests/my-progress", { credentials: "include", signal: c.signal }).then(async r => r.ok ? r.json() as Promise<UserProgress> : null),
    ]).then(([qs, p]) => { setAll(qs); setProg(p); if (qs.length > 0) { const ac = qs.filter(q => q.status === "ACTIVE").length; if (ac === 0) { const fb = TABS.find(t => qs.some(q => q.status === t.id)); if (fb) setStatus(fb.id); } } })
      .catch((e: unknown) => { setErr(e instanceof Error ? e.message : "Could not load"); setAll([]); }).finally(() => setLoading(false));
    return () => { clearTimeout(t); c.abort(); };
  }, []);
  useEffect(() => { const cl = load(); return cl; }, [load]);

  const counts = useMemo(() => { const c: Record<QuestStatus, number> = { ACTIVE: 0, COMING_SOON: 0, ENDED: 0 }; for (const q of all) c[q.status]++; return c; }, [all]);
  const filtered = useMemo(() => all.filter(q => q.status === status && matches(q, query)), [all, status, query]);
  useEffect(() => { setPage(1); }, [status, query]);
  const tp = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="w-full max-w-full overflow-hidden space-y-4">
      {isEarn ? (
        <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(tab => { const s = status === tab.id; return <button key={tab.id} type="button" onClick={() => setStatus(tab.id)} className={filterTabClass(s, "text-xs px-3 py-1.5")}>{QUEST_STATUS_BADGE[tab.id].label} ({counts[tab.id]})</button>; })}
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map(tab => { const s = status === tab.id; return <button key={tab.id} type="button" onClick={() => setStatus(tab.id)} className={filterTabClass(s)}>{QUEST_STATUS_BADGE[tab.id].label} ({counts[tab.id]})</button>; })}
          </div>
          <label className="relative block w-full sm:max-w-xs"><span className="sr-only">{t("quests.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="w-full rounded-md border border-[var(--border)] bg-[var(--muted)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/50 transition-colors" autoComplete="off" />
          </label>
        </div>
      )}

      {loading ? (isEarn ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <EarnCampaignSkeleton key={i} />)}</div> : <PageLoading minHeight="min-h-0" className="py-20" />)
      : err ? <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-10 text-center text-sm text-red-200">{err}{isEarn && isWalletRequiredLoadError(err) ? <Link href="/wallet" className={cn(buttonVariants({ size: "sm" }), "mt-4 inline-flex")}>{t("dashboard.createWallet")}</Link> : <button type="button" onClick={() => load()} className={cn(buttonVariants({ size: "sm" }), "mt-4")}>Retry</button>}</div>
      : filtered.length === 0 ? <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] py-16 text-center text-sm text-[var(--muted-foreground)]">{query ? t("quests.noMatch") : t("quests.noPrograms")}</div>
      : <><div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", isEarn && "md:gap-5")}>{paged.map(q => <div key={q.id}>{isEarn ? <EarnCampaignCard quest={q} completed={prog?.completedQuestIds.includes(q.id) ?? false} userProgress={prog} /> : <QuestCard quest={q} completed={prog?.completedQuestIds.includes(q.id) ?? false} />}</div>)}</div>
        <ListPagination page={page} totalPages={tp} total={filtered.length} onPageChange={setPage} /></>
      }
    </div>
  );
}