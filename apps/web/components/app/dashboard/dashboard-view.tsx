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
  /** Lifetime points — same field as Quest page (`/api/me`, reconciled on server). */
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
    <div className="space-y-8">
      {loadError ? (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-6 py-4 text-sm text-orange-200">
          {loadError}{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void fetchAll()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Stat cards — order: Weekly rank → CC Balance → CC Transactions → Quests completed → Quest points */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              className="glass-card rounded-3xl border border-white/5 p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-400">{c.title}</p>
                <Icon className="h-5 w-5 text-slate-500" aria-hidden />
              </div>
              <StatValue className="mt-3 text-2xl font-bold text-slate-100">
                {c.value === null ? (
                  <LoadingSpinner size="xl" tone="muted" />
                ) : (
                  c.value
                )}
              </StatValue>
              {c.hint ? (
                <p className="mt-2 text-sm font-medium text-slate-400">{c.hint}</p>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* Recent Activity */}
      <section className="rounded-3xl border border-white/5 bg-[var(--card)] p-8 shadow-sm">
          <SectionTitle className="text-xl font-bold text-slate-100">{t("dashboard.recentActivity")}</SectionTitle>

          {activityLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : !activityData || activityData.items.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-slate-800/80 py-12 text-center">
              <p className="text-sm font-medium text-slate-400">
                {t("dashboard.noActivity")}
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-6 divide-y divide-slate-800/80">
                {activityData.items.map((item, i) => {
                  const Icon = ACTIVITY_ICON[item.type];
                  const colorClass = ACTIVITY_COLOR[item.type];
                  return (
                    <li
                      key={`${item.type}-${item.time}-${i}`}
                      className="flex items-start gap-4 py-4"
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                          colorClass,
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-slate-100">{item.title}</p>
                        <p className="mt-1 text-sm font-medium text-slate-400">{item.detail}</p>
                      </div>
                      <p className="shrink-0 text-sm font-medium text-slate-400 pt-1">
                        {timeAgo(item.time, t)}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <ListPagination
                className="mt-6"
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
  );
}
