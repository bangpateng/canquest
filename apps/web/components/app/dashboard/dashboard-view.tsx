"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionTitle, StatValue } from "@/components/ui/typography";
import { cn } from "@/lib/utils/utils";
import { CheckCircle2, Coins, Gift, TrendingUp, Trophy, Zap, Sparkles } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ListPagination } from "@/components/app/list/list-pagination";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { createRefetchThrottle } from "@/lib/utils/refetch-throttle";
import {
  cacheWalletMe,
  isRealCantonPartyId,
  readCachedWalletMe,
  readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { usePlatformT } from "@/lib/i18n/platform-provider";

const FOCUS_REFETCH_MIN_MS = 60_000;
const throttleFocusRefetch = createRefetchThrottle(FOCUS_REFETCH_MIN_MS);

const ACTIVITY_PAGE_SIZE = 5;

interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  earnPoints?: number;
}

interface DashboardStats {
  totalPoints: number;
  questsCompleted: number;
  txCount: number;
  weeklyRank: number;
}

interface ActivityItem {
  type: "quest_completed" | "task_verified" | "cc_transfer";
  title: string;
  detail: string;
  time: string;
}

interface ActivityPage {
  items: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function timeAgo(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minutesAgo", { n: mins });
  if (hours < 24) return t("time.hoursAgo", { n: hours });
  if (days === 1) return t("time.yesterday");
  return t("time.daysAgo", { n: days });
}

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ElementType> = {
  quest_completed: Trophy,
  task_verified: CheckCircle2,
  cc_transfer: Coins,
};

const ACTIVITY_COLOR: Record<ActivityItem["type"], string> = {
  quest_completed: "bg-[var(--primary)]/15 text-[var(--primary)]",
  task_verified: "bg-emerald-500/15 text-emerald-400",
  cc_transfer: "bg-blue-500/15 text-blue-400",
};

const FETCH_TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string): Promise<{ ok: boolean; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data: res.ok ? data : null };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export function DashboardView() {
  const t = usePlatformT();
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activityData, setActivityData] = useState<ActivityPage | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchActivity = useCallback(async (page: number) => {
    setActivityLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `/api/quests/activity?page=${page}&pageSize=${ACTIVITY_PAGE_SIZE}`,
        { credentials: "include", signal: controller.signal },
      );
      if (res.ok) {
        setActivityData((await res.json()) as ActivityPage);
      } else {
        setActivityData({
          items: [],
          total: 0,
          page,
          pageSize: ACTIVITY_PAGE_SIZE,
          totalPages: 1,
        });
      }
    } catch {
      setActivityData({
        items: [],
        total: 0,
        page,
        pageSize: ACTIVITY_PAGE_SIZE,
        totalPages: 1,
      });
    } finally {
      clearTimeout(timer);
      setActivityLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setLoadError(null);
    try {
      const [meResult, statsResult] = await Promise.all([
        fetchJson<Me>("/api/me"),
        fetchJson<DashboardStats>("/api/quests/dashboard-stats"),
      ]);

      if (meResult.ok && meResult.data) {
        setMe(meResult.data);
        cacheWalletMe(meResult.data);
      } else {
        const cached = readCachedWalletMe(readLastWalletUserId());
        if (cached) setMe((prev) => prev ?? cached);
      }
      if (statsResult.ok && statsResult.data) {
        const earnPoints =
          typeof meResult.data?.earnPoints === "number"
            ? meResult.data.earnPoints
            : statsResult.data.totalPoints;
        setStats({ ...statsResult.data, totalPoints: earnPoints });
      } else if (meResult.ok && typeof meResult.data?.earnPoints === "number") {
        setStats({
          totalPoints: meResult.data.earnPoints,
          questsCompleted: 0,
          txCount: 0,
          weeklyRank: 0,
        });
      } else {
        setStats({ totalPoints: 0, questsCompleted: 0, txCount: 0, weeklyRank: 0 });
      }

      if (!meResult.ok && !statsResult.ok) {
        setLoadError(
          "Could not load dashboard. Make sure API is running on port 3001 and you are logged in.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState !== "visible") return;
      throttleFocusRefetch(() => void fetchAll({ background: true }));
    };
    window.addEventListener("focus", refreshOnVisible);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnVisible);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [fetchAll]);

  useEffect(() => {
    void fetchActivity(activityPage);
  }, [fetchActivity, activityPage]);

  const lifetimePoints =
    typeof me?.earnPoints === "number"
      ? me.earnPoints
      : (stats?.totalPoints ?? 0);

  const hasWallet = isRealCantonPartyId(me?.cantonPartyId);

  const { balance, loading: balanceLoading } = useCcBalance({
    enabled: hasWallet,
    pollIntervalMs: 90_000,
  });

  const statCards = [
    {
      key: "weeklyRank",
      title: t("dashboard.weeklyRank"),
      value: loading ? null : stats?.weeklyRank ? `#${stats.weeklyRank}` : "—",
      hint: t("dashboard.weeklyRankHint"),
      icon: Trophy,
      gradient: "from-amber-500/20 to-orange-500/5",
      iconBg: "bg-amber-500/10 ring-amber-500/20",
      iconColor: "text-amber-400",
    },
    {
      key: "ccBalance",
      title: t("dashboard.ccBalance"),
      value: loading || (hasWallet && balanceLoading)
        ? null
        : !hasWallet
          ? t("dashboard.noWallet")
          : balance !== null
            ? `${balance.toFixed(4)} CC`
            : "—",
      hint: hasWallet ? t("dashboard.ccBalanceHintLive") : t("dashboard.ccBalanceHintCreate"),
      icon: Coins,
      gradient: "from-blue-500/20 to-cyan-500/5",
      iconBg: "bg-blue-500/10 ring-blue-500/20",
      iconColor: "text-blue-400",
    },
    {
      key: "ccTransactions",
      title: t("dashboard.ccTransactions"),
      value: loading ? null : (stats?.txCount ?? 0).toString(),
      hint: t("dashboard.ccTransactionsHint"),
      icon: Zap,
      gradient: "from-purple-500/20 to-violet-500/5",
      iconBg: "bg-purple-500/10 ring-purple-500/20",
      iconColor: "text-purple-400",
    },
    {
      key: "questsCompleted",
      title: t("dashboard.questsCompleted"),
      value: loading ? null : (stats?.questsCompleted ?? 0).toString(),
      hint: t("dashboard.questsCompletedHint"),
      icon: Gift,
      gradient: "from-emerald-500/20 to-teal-500/5",
      iconBg: "bg-emerald-500/10 ring-emerald-500/20",
      iconColor: "text-emerald-400",
    },
    {
      key: "questPoints",
      title: t("dashboard.questPoints"),
      value: loading ? null : lifetimePoints.toLocaleString(),
      hint: t("dashboard.questPointsHint"),
      icon: TrendingUp,
      gradient: "from-rose-500/20 to-pink-500/5",
      iconBg: "bg-rose-500/10 ring-rose-500/20",
      iconColor: "text-rose-400",
    },
  ];

  return (
    <div className="w-full max-w-full overflow-x-hidden font-sans">
      <div className="w-full min-h-screen max-w-7xl mx-auto">
        <div className="space-y-5 md:space-y-6">

          {/* ── Welcome Banner ───────────────────────────────────────────── */}
          {!loadError && (
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 sm:p-8">
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.08),transparent_60%)]"
                aria-hidden
              />
              <div className="relative">
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                    {me?.displayName
                      ? `Welcome back, ${me.displayName.split(" ")[0]}`
                      : "Welcome to CanQuest"}
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Complete quests, earn CC tokens, and climb the leaderboard.
                  </p>
              </div>
            </div>
          )}

          {/* ── Error Banner ─────────────────────────────────────────────── */}
          {loadError ? (
            <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 backdrop-blur-xl shadow-xl shadow-black/30 px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/20">
                  <svg className="h-5 w-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-orange-200 leading-relaxed">
                    {loadError}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-orange-500/20 px-4 py-2 text-sm font-semibold text-orange-200 transition-all duration-200 hover:bg-orange-500/30 hover:text-orange-100"
                  onClick={() => void fetchAll()}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Premium Bento Grid ─────────────────────────────────────── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-5">
            {/* Hero Card — Weekly Rank (Large Feature, spans 7 cols, 2 rows) */}
            <div className="sm:col-span-2 lg:col-span-7 lg:row-span-2 relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] group p-6 sm:p-8 md:p-10">
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_100%_0%,rgb(251_191_36/0.06),transparent_70%)]"
                aria-hidden
              />
              <div className="relative flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20 transition-all duration-300 group-hover:ring-amber-500/30 group-hover:scale-105">
                      <Trophy className="h-7 w-7 text-amber-400" aria-hidden />
                    </div>
                    <div>
                      <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                        {statCards[0].title}
                      </span>
                    </div>
                  </div>
                  <div className="mt-8">
                    {statCards[0].value === null ? (
                      <div className="flex items-center h-24">
                        <LoadingSpinner size="xl" tone="muted" />
                      </div>
                    ) : (
                      <p className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white glow-text">
                        {statCards[0].value}
                      </p>
                    )}
                  </div>
                </div>
                {statCards[0].hint ? (
                  <p className="mt-8 text-xs sm:text-sm text-slate-400 font-normal leading-relaxed line-clamp-2">
                    {statCards[0].hint}
                  </p>
                ) : null}
              </div>
            </div>

            {/* CC Balance Card — Prominent Secondary (5 cols) */}
            <div className="sm:col-span-2 lg:col-span-5 lg:row-span-2 relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] group p-5 sm:p-6 md:p-8">
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgb(59_130_246/0.06),transparent_70%)]"
                aria-hidden
              />
              <div className="relative flex flex-col h-full">
                <div className="flex items-start justify-between mb-4">
                  <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                    {statCards[1].title}
                  </span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20 transition-all duration-300 group-hover:ring-blue-500/30 group-hover:scale-105">
                    <Coins className="h-5 w-5 text-blue-400" aria-hidden />
                  </div>
                </div>
                <div className="mt-6 flex-1 flex items-center">
                  {statCards[1].value === null ? (
                    <LoadingSpinner size="lg" tone="muted" />
                  ) : (
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-white break-words">
                      {statCards[1].value}
                    </p>
                  )}
                </div>
                {statCards[1].hint ? (
                  <p className="mt-6 text-xs sm:text-sm text-slate-400 font-normal leading-relaxed line-clamp-2">
                    {statCards[1].hint}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Compact Stat Cards — 3 across bottom (4 cols each) */}
            {statCards.slice(2).map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className="lg:col-span-4 relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] group p-5 sm:p-6"
                >
                  {/* Subtle gradient accent */}
                  <div
                    className={`pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_100%_0%,var(--tw-gradient-from),transparent_70%)] bg-gradient-to-br ${card.gradient}`}
                    aria-hidden
                  />
                  <div className="relative flex items-start justify-between mb-4">
                    <span className="text-xs sm:text-sm font-medium text-slate-500 tracking-tight">
                      {card.title}
                    </span>
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg ring-1 transition-all duration-300 group-hover:scale-105", card.iconBg)}>
                      <Icon className={cn("h-4 w-4", card.iconColor)} aria-hidden />
                    </div>
                  </div>
                  <div className="relative mt-4">
                    {card.value === null ? (
                      <LoadingSpinner size="lg" tone="muted" />
                    ) : (
                      <p className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                        {card.value}
                      </p>
                    )}
                  </div>
                  {card.hint ? (
                    <p className="relative mt-4 text-xs text-slate-500 font-normal leading-relaxed line-clamp-2">
                      {card.hint}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </section>

          {/* ── Recent Activity — same layout as Wallet transactions ───── */}
          <section className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-5">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                {t("dashboard.recentActivity")}
              </h2>
            </div>

            {activityLoading ? (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner size="lg" />
              </div>
            ) : !activityData || activityData.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
                {t("dashboard.noActivity")}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <table className="w-full text-left hidden md:table">
                  <thead className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">
                    <tr>
                      <th className="px-4 py-3 md:px-5">Type</th>
                      <th className="px-4 py-3 md:px-5">Title</th>
                      <th className="px-4 py-3 md:px-5">Detail</th>
                      <th className="px-4 py-3 text-right md:px-5">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityData.items.map((item, i) => {
                      const Icon = ACTIVITY_ICON[item.type];
                      const colorClass = ACTIVITY_COLOR[item.type];
                      return (
                        <tr key={`${item.type}-${item.time}-${i}`} className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50">
                          <td className="px-4 py-3 md:px-5">
                            <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", colorClass)}>
                              <Icon className="h-4 w-4" aria-hidden />
                            </span>
                          </td>
                          <td className="px-4 py-3 md:px-5 text-sm font-semibold text-[var(--foreground)] truncate">{item.title}</td>
                          <td className="px-4 py-3 md:px-5 text-sm text-[var(--muted-foreground)] max-w-[16rem] truncate">{item.detail}</td>
                          <td className="px-4 py-3 md:px-5 text-xs text-[var(--muted-foreground)] text-right whitespace-nowrap">{timeAgo(item.time, t)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Mobile list */}
                <ul className="divide-y divide-[var(--border)] md:hidden">
                  {activityData.items.map((item, i) => {
                    const Icon = ACTIVITY_ICON[item.type];
                    const colorClass = ACTIVITY_COLOR[item.type];
                    return (
                      <li key={`${item.type}-${item.time}-${i}`} className="flex items-center gap-3 px-4 py-3">
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", colorClass)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--foreground)] truncate">{item.title}</p>
                          <p className="text-xs text-[var(--muted-foreground)] truncate">{item.detail}</p>
                        </div>
                        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{timeAgo(item.time, t)}</span>
                      </li>
                    );
                  })}
                </ul>

                <ListPagination
                  className="px-4 py-3"
                  page={activityPage}
                  totalPages={activityData.totalPages}
                  total={activityData.total}
                  disabled={activityLoading}
                  onPageChange={setActivityPage}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}