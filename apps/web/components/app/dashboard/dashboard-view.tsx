"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionTitle, StatValue } from "@/components/ui/typography";
import { cn } from "@/lib/utils/utils";
import { CheckCircle2, Coins, Gift, TrendingUp, Trophy, Zap } from "lucide-react";
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
  quest_completed: "bg-[var(--primary)]/15 text-[var(--foreground)]",
  task_verified: "bg-green-500/10 text-green-600 dark:text-green-400",
  cc_transfer: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
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
    },
    {
      key: "ccTransactions",
      title: t("dashboard.ccTransactions"),
      value: loading ? null : (stats?.txCount ?? 0).toString(),
      hint: t("dashboard.ccTransactionsHint"),
      icon: Zap,
    },
    {
      key: "questsCompleted",
      title: t("dashboard.questsCompleted"),
      value: loading ? null : (stats?.questsCompleted ?? 0).toString(),
      hint: t("dashboard.questsCompletedHint"),
      icon: Gift,
    },
    {
      key: "questPoints",
      title: t("dashboard.questPoints"),
      value: loading ? null : lifetimePoints.toLocaleString(),
      hint: t("dashboard.questPointsHint"),
      icon: TrendingUp,
    },
  ];

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="w-full min-h-screen px-4 py-6 sm:p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <div className="space-y-6 md:space-y-8">
          {/* Error Banner */}
          {loadError ? (
            <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 backdrop-blur-xl shadow-2xl shadow-black/40 sm:px-6 sm:py-5">
              <p className="text-sm font-medium text-orange-200 leading-relaxed">
                {loadError}{" "}
                <button
                  type="button"
                  className="font-semibold underline decoration-orange-400/50 underline-offset-4 transition-colors hover:text-orange-100"
                  onClick={() => void fetchAll()}
                >
                  Retry
                </button>
              </p>
            </div>
          ) : null}

          {/* Premium Bento Grid - Asymmetrical Stats Layout */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Hero Stat Card - Weekly Rank (Spans 2 columns on large screens) */}
            <div className="lg:col-span-2 lg:row-span-2 rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all duration-300 hover:border-white/10 hover:shadow-black/50 p-6 sm:p-8 md:p-10">
              <div className="flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
                      <Trophy className="h-6 w-6 text-[var(--primary)]" aria-hidden />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-slate-500 uppercase tracking-wider">
                        {statCards[0].title}
                      </p>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    {statCards[0].value === null ? (
                      <div className="flex items-center h-20">
                        <LoadingSpinner size="xl" tone="muted" />
                      </div>
                    ) : (
                      <p className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white">
                        {statCards[0].value}
                      </p>
                    )}
                  </div>
                </div>
                
                {statCards[0].hint ? (
                  <p className="mt-6 text-xs sm:text-sm font-normal leading-relaxed text-slate-400">
                    {statCards[0].hint}
                  </p>
                ) : null}
              </div>
            </div>

            {/* CC Balance Card - Prominent Display */}
            <div className="lg:row-span-2 rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all duration-300 hover:border-white/10 hover:shadow-black/50 p-5 sm:p-6 md:p-8">
              <div className="flex items-start justify-between mb-4">
                <p className="text-xs sm:text-sm font-medium text-slate-500 uppercase tracking-wider">
                  {statCards[1].title}
                </p>
                <Coins className="h-5 w-5 text-slate-500" aria-hidden />
              </div>
              
              <div className="mt-6">
                {statCards[1].value === null ? (
                  <div className="flex items-center h-16">
                    <LoadingSpinner size="lg" tone="muted" />
                  </div>
                ) : (
                  <p className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white break-words">
                    {statCards[1].value}
                  </p>
                )}
              </div>
              
              {statCards[1].hint ? (
                <p className="mt-4 text-xs sm:text-sm font-normal leading-relaxed text-slate-400">
                  {statCards[1].hint}
                </p>
              ) : null}
            </div>

            {/* Compact Stat Cards - Grid of 3 */}
            {statCards.slice(2).map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className="rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all duration-300 hover:border-white/10 hover:shadow-black/50 p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-xs sm:text-sm font-medium text-slate-500">
                      {card.title}
                    </p>
                    <Icon className="h-4 w-4 text-slate-500" aria-hidden />
                  </div>
                  
                  <div className="mt-3">
                    {card.value === null ? (
                      <LoadingSpinner size="lg" tone="muted" />
                    ) : (
                      <p className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                        {card.value}
                      </p>
                    )}
                  </div>
                  
                  {card.hint ? (
                    <p className="mt-3 text-xs font-normal leading-relaxed text-slate-500">
                      {card.hint}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </section>

          {/* Recent Activity - Premium Glassmorphic Card */}
          <section className="w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40">
            <div className="border-b border-white/5 bg-white/[0.02] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
              <h2 className="text-base sm:text-lg font-semibold tracking-tight text-white">
                {t("dashboard.recentActivity")}
              </h2>
            </div>

            {activityLoading ? (
              <div className="flex items-center justify-center py-16 sm:py-20">
                <LoadingSpinner size="lg" />
              </div>
            ) : !activityData || activityData.items.length === 0 ? (
              <div className="px-5 py-16 text-center sm:px-6 sm:py-20 md:px-8">
                <p className="text-sm font-medium text-slate-500">
                  {t("dashboard.noActivity")}
                </p>
              </div>
            ) : (
              <div className="p-5 sm:p-6 md:p-8">
                <ul className="space-y-2">
                  {activityData.items.map((item, i) => {
                    const Icon = ACTIVITY_ICON[item.type];
                    const colorClass = ACTIVITY_COLOR[item.type];
                    return (
                      <li
                        key={`${item.type}-${item.time}-${i}`}
                        className="group flex flex-col sm:flex-row sm:items-start gap-3 rounded-2xl px-4 py-4 transition-all duration-200 hover:bg-white/[0.02] sm:gap-4"
                      >
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl",
                            colorClass,
                          )}
                        >
                          <Icon className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm sm:text-base font-semibold text-white leading-snug">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs sm:text-sm font-normal text-slate-500 leading-relaxed">
                            {item.detail}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs sm:text-sm font-medium text-slate-500 sm:pt-1">
                          {timeAgo(item.time, t)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <ListPagination
                  className="mt-6 sm:mt-8"
                  page={activityPage}
                  totalPages={activityData.totalPages}
                  total={activityData.total}
                  disabled={activityLoading}
                  onPageChange={setActivityPage}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
