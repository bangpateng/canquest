"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { Coins, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ListPagination } from "@/components/app/list/list-pagination";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { createRefetchThrottle } from "@/lib/utils/refetch-throttle";
import {
  cacheWalletMe, isRealCantonPartyId,
  readCachedWalletMe, readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { usePlatformT } from "@/lib/i18n/platform-provider";

const FOCUS_REFETCH_MIN_MS = 60_000;
const throttleFocusRefetch = createRefetchThrottle(FOCUS_REFETCH_MIN_MS);
const ACTIVITY_PAGE_SIZE = 5;

interface Me { id?: string; email?: string; displayName?: string | null; username?: string | null; cantonPartyId?: string | null; earnPoints?: number; }
interface DashboardStats { totalPoints: number; questsCompleted: number; txCount: number; weeklyRank: number; }
interface ActivityItem { type: "quest_completed" | "task_verified" | "cc_transfer"; title: string; detail: string; time: string; }
interface ActivityPage { items: ActivityItem[]; total: number; page: number; pageSize: number; totalPages: number; }

function timeAgo(iso: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return t("time.justNow");
  if (m < 60) return t("time.minutesAgo", { n: m });
  if (h < 24) return t("time.hoursAgo", { n: h });
  if (d === 1) return t("time.yesterday");
  return t("time.daysAgo", { n: d });
}

const FETCH_TIMEOUT_MS = 12_000;
async function fetchJson<T>(url: string): Promise<{ ok: boolean; data: T | null }> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  try { const r = await fetch(url, { credentials: "include", cache: "no-store", signal: c.signal }); const d = (await r.json().catch(() => null)) as T | null; return { ok: r.ok, data: r.ok ? d : null }; }
  catch { return { ok: false, data: null }; }
  finally { clearTimeout(t); }
}

export function DashboardView() {
  const t = usePlatformT();
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [act, setAct] = useState<ActivityPage | null>(null);
  const [page, setPage] = useState(1);
  const [actLoad, setActLoad] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchAct = useCallback(async (p: number) => {
    setActLoad(true);
    try {
      const r = await fetch(`/api/quests/activity?page=${p}&pageSize=${ACTIVITY_PAGE_SIZE}`, { credentials: "include" });
      if (r.ok) setAct(await r.json() as ActivityPage);
      else setAct({ items: [], total: 0, page: p, pageSize: ACTIVITY_PAGE_SIZE, totalPages: 1 });
    } catch { setAct({ items: [], total: 0, page: p, pageSize: ACTIVITY_PAGE_SIZE, totalPages: 1 }); }
    finally { setActLoad(false); }
  }, []);

  const fetchAll = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true); setErr(null);
    const [mr, sr] = await Promise.all([fetchJson<Me>("/api/me"), fetchJson<DashboardStats>("/api/quests/dashboard-stats")]);
    if (mr.ok && mr.data) { setMe(mr.data); cacheWalletMe(mr.data); }
    else { const c = readCachedWalletMe(readLastWalletUserId()); if (c) setMe(p => p ?? c); }
    if (sr.ok && sr.data) { const ep = typeof mr.data?.earnPoints === "number" ? mr.data.earnPoints : sr.data.totalPoints; setStats({ ...sr.data, totalPoints: ep }); }
    else if (mr.ok && typeof mr.data?.earnPoints === "number") setStats({ totalPoints: mr.data.earnPoints, questsCompleted: 0, txCount: 0, weeklyRank: 0 });
    else setStats({ totalPoints: 0, questsCompleted: 0, txCount: 0, weeklyRank: 0 });
    if (!mr.ok && !sr.ok) setErr("Could not load dashboard.");
    setLoading(false);
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);
  useEffect(() => { const cb = () => { if (document.visibilityState !== "visible") return; throttleFocusRefetch(() => void fetchAll({ background: true })); }; window.addEventListener("focus", cb); document.addEventListener("visibilitychange", cb); return () => { window.removeEventListener("focus", cb); document.removeEventListener("visibilitychange", cb); }; }, [fetchAll]);
  useEffect(() => { void fetchAct(page); }, [fetchAct, page]);

  const points = typeof me?.earnPoints === "number" ? me.earnPoints : (stats?.totalPoints ?? 0);
  const hw = isRealCantonPartyId(me?.cantonPartyId);
  const { balance, loading: bl } = useCcBalance({ enabled: hw, pollIntervalMs: 90_000 });

  function StatCard({ label, value, sub }: { label: string; value: string | null; sub: string }) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 md:p-5">
        <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--foreground)]">{value ?? <LoadingSpinner size="sm" />}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{sub}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4 md:space-y-5">
      {err ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">{err}</div>
      ) : null}

      {me?.displayName && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 md:px-5 md:py-4">
          <p className="text-sm font-semibold text-[var(--foreground)]">Welcome back, {me.displayName.split(" ")[0]}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        <StatCard label="Weekly Rank" value={loading ? null : stats?.weeklyRank ? `#${stats.weeklyRank}` : "—"} sub="Your position this week" />
        <StatCard label="CC Balance" value={loading || (hw && bl) ? null : !hw ? "No wallet" : balance !== null ? `${balance.toFixed(4)} CC` : "—"} sub={hw ? "Live balance" : "Create a wallet"} />
        <StatCard label="Transactions" value={loading ? null : `${stats?.txCount ?? 0}`} sub="On-chain activity" />
        <StatCard label="Quests Done" value={loading ? null : `${stats?.questsCompleted ?? 0}`} sub="Completed quests" />
        <StatCard label="Points" value={loading ? null : points.toLocaleString()} sub="Lifetime earned" />
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3 md:px-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("dashboard.recentActivity")}</h2>
        </div>
        {actLoad ? <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        : !act || act.items.length === 0 ? <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">{t("dashboard.noActivity")}</div>
        : <div className="divide-y divide-[var(--border)]">
            {act.items.map((it, i) => (
              <div key={`${it.type}-${it.time}-${i}`} className="flex items-center justify-between px-4 py-3 md:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">{it.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate">{it.detail}</p>
                </div>
                <span className="shrink-0 ml-3 text-xs text-[var(--muted-foreground)]">{timeAgo(it.time, t)}</span>
              </div>
            ))}
            <ListPagination className="px-4 py-3" page={page} totalPages={act.totalPages} total={act.total} disabled={actLoad} onPageChange={setPage} />
          </div>
        }
      </section>
    </div>
  );
}