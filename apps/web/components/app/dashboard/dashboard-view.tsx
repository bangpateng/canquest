"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { CheckCircle2, Coins, Trophy } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ListPagination } from "@/components/app/list/list-pagination";
import { createRefetchThrottle } from "@/lib/utils/refetch-throttle";
import {
  cacheWalletMe,
  isRealCantonPartyId,
  readCachedWalletMe,
  readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { cn } from "@/lib/utils/utils";

import { CcPriceCard } from "./cc-price-card";
import { ProfileCard } from "./profile-card";
import { CcHoldingsCard } from "./cc-holdings-card";
import { PointsCard } from "./points-card";
import { ActivityStatsCard } from "./activity-stats-card";

const FOCUS_REFETCH_MIN_MS = 60_000;
const throttleFocusRefetch = createRefetchThrottle(FOCUS_REFETCH_MIN_MS);

const ACTIVITY_PAGE_SIZE = 5;

interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  twitterUsername?: string | null;
  avatarUrl?: string | null;
  earnPoints?: number;
}

interface DashboardStats {
  totalPoints: number;
  questsCompleted: number;
  txCount: number;
  weeklyRank: number;
  pointsSpent?: number;
  pointsRemaining?: number;
  earnHubCompleted?: number;
  campaignCompleted?: number;
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

const EMPTY_STATS: DashboardStats = {
  totalPoints: 0,
  questsCompleted: 0,
  txCount: 0,
  weeklyRank: 0,
  pointsSpent: 0,
  pointsRemaining: 0,
  earnHubCompleted: 0,
  campaignCompleted: 0,
};

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
        setStats({ ...EMPTY_STATS, totalPoints: meResult.data.earnPoints });
      } else {
        setStats(EMPTY_STATS);
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

  const hasWallet = isRealCantonPartyId(me?.cantonPartyId);
  const s = stats ?? EMPTY_STATS;

  return (
    <div className="w-full max-w-full overflow-x-hidden font-sans">
      <div className="w-full min-h-screen max-w-7xl mx-auto">
        <div className="space-y-5 md:space-y-6">

          {/* ── Page Header ──────────────────────────────────────────────── */}
          {!loadError && (
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 sm:p-8">
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.08),transparent_60%)]"
                aria-hidden
              />
              <div className="relative">
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  {me?.displayName
                    ? t("dashboard.welcomeBack", { name: me.displayName.split(" ")[0] })
                    : t("dashboard.welcomeGuest")}
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  {t("dashboard.overviewSubtitle")}
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

          {/* ── Cards Bento Grid ─────────────────────────────────────────── */}
          {!loadError && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-5">
              {/* Profile (full width on mobile, 6 cols on desktop) */}
              <div className="sm:col-span-2 lg:col-span-6">
                <ProfileCard
                  displayName={me?.displayName}
                  username={me?.username}
                  twitterUsername={me?.twitterUsername}
                  avatarUrl={me?.avatarUrl}
                  weeklyRank={loading ? null : s.weeklyRank || null}
                  loading={loading}
                />
              </div>

              {/* CC Price + chart (6 cols) */}
              <div className="sm:col-span-2 lg:col-span-6">
                <CcPriceCard />
              </div>

              {/* CC Holdings (4 cols) */}
              <div className="sm:col-span-2 lg:col-span-4">
                <CcHoldingsCard hasWallet={hasWallet} />
              </div>

              {/* Points (4 cols) */}
              <div className="sm:col-span-1 lg:col-span-4">
                <PointsCard
                  totalEarned={s.totalPoints}
                  spent={s.pointsSpent ?? 0}
                  remaining={s.pointsRemaining ?? s.totalPoints}
                  loading={loading}
                />
              </div>

              {/* Activity totals (4 cols) */}
              <div className="sm:col-span-1 lg:col-span-4">
                <ActivityStatsCard
                  questsDone={s.earnHubCompleted ?? 0}
                  earnDone={s.campaignCompleted ?? 0}
                  onchainTx={s.txCount}
                  loading={loading}
                />
              </div>
            </section>
          )}

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
