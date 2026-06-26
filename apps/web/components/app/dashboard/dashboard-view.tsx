"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cacheWalletMe,
  isRealCantonPartyId,
  readCachedWalletMe,
  readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { createRefetchThrottle } from "@/lib/utils/refetch-throttle";

import { CcPriceCard } from "./cc-price-card";
import { ProfileCard } from "./profile-card";
import { CcHoldingsCard } from "./cc-holdings-card";
import { PointsCard } from "./points-card";
import { ActivityStatsCard } from "./activity-stats-card";
import {
  getPointsBalance,
  type PointsBalance,
} from "@/lib/services/api/points";

const FOCUS_REFETCH_MIN_MS = 60_000;
const throttleFocusRefetch = createRefetchThrottle(FOCUS_REFETCH_MIN_MS);

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
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pointsBalance, setPointsBalance] = useState<PointsBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setLoadError(null);
    try {
      const [meResult, statsResult, pointsResult] = await Promise.all([
        fetchJson<Me>("/api/me"),
        fetchJson<DashboardStats>("/api/quests/dashboard-stats"),
        getPointsBalance().then(
          (data) => ({ ok: true, data }) as { ok: true; data: PointsBalance },
        ).catch(() => ({ ok: false, data: null }) as { ok: false; data: null }),
      ]);

      if (meResult.ok && meResult.data) {
        setMe(meResult.data);
        cacheWalletMe(meResult.data);
      } else {
        const cached = readCachedWalletMe(readLastWalletUserId());
        if (cached) setMe((prev) => prev ?? cached);
      }
      if (statsResult.ok && statsResult.data) {
        setStats(statsResult.data);
      } else {
        setStats(EMPTY_STATS);
      }
      if (pointsResult.ok && pointsResult.data) {
        setPointsBalance(pointsResult.data);
      }

      if (!meResult.ok && !statsResult.ok) {
        setLoadError(
          "Could not load dashboard",
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

  const hasWallet = isRealCantonPartyId(me?.cantonPartyId);
  const s = stats ?? EMPTY_STATS;

  return (
    <div className="w-full max-w-full overflow-x-hidden font-sans">
      <div className="w-full min-h-screen max-w-7xl mx-auto">
        <div className="space-y-5 md:space-y-6">

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
                  remaining={pointsBalance?.remaining ?? s.pointsRemaining ?? 0}
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
        </div>
      </div>
    </div>
  );
}
