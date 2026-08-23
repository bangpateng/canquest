"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cacheWalletMe,
  isRealCantonPartyId,
  readCachedWalletMe,
  readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { createRefetchThrottle } from "@/lib/utils/refetch-throttle";
import { useMe } from "@/lib/hooks/use-me";
import { usePoints } from "@/lib/hooks/use-points";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

import { CcHoldingsCard } from "./cc-holdings-card";
import { ProfileCard } from "./profile-card";
import { PointsCard } from "./points-card";
import { ActivityStatsCard } from "./activity-stats-card";
import { LiveCampaignsStrip, RecentActivityFeed } from "./overview-widgets";
import { PageLoading } from "@/components/ui/loading-spinner";

const FOCUS_REFETCH_MIN_MS = 60_000;
const throttleFocusRefetch = createRefetchThrottle(FOCUS_REFETCH_MIN_MS);

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
  // Profil user via cache global `useMe` — ter-dedup lintas halaman.
  // Sebelumnya `me` di-fetch manual di dalam Promise.all (bersama stats & points).
  const { me, isError: meError } = useMe();
  // Points via react-query (key dishare dengan Quest hub — tidak ada fetch ganda).
  const { data: pointsBalance } = usePoints();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sinkronkan cache wallet (sessionStorage) tiap kali `me` berubah.
  // Fallback cache dipertahankan: saat /api/me gagal, pakai data tersimpan.
  useEffect(() => {
    if (me) {
      cacheWalletMe(me);
    } else if (meError) {
      const cached = readCachedWalletMe(readLastWalletUserId());
      // Tidak ada setter state (me dari hook); cache hanya untuk konsumen lain.
      void cached;
    }
  }, [me, meError]);

  const fetchAll = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setLoadError(null);
    try {
      // `/api/me` + points sudah ditangani useMe()/usePoints() — di sini hanya stats.
      const statsResult = await fetchJson<DashboardStats>(
        "/api/quests/dashboard-stats",
      );

      if (statsResult.ok && statsResult.data) {
        setStats(statsResult.data);
      } else {
        setStats(EMPTY_STATS);
      }

      if (!statsResult.ok) {
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
  // Spinner awal hanya saat fetch pertama (sebelum data ada), sama seperti menu lain.
  // Background refetch (focus/visibility) tidak men-trigger ini, jadi kartu tidak berkedip.
  const initialLoading = loading && !stats && !me;

  return (
    <div className="w-full max-w-full overflow-x-hidden font-sans">
      <div className="w-full min-h-screen max-w-7xl mx-auto">
        <div className="space-y-5 md:space-y-6">

          {/* ── Initial Loading Spinner (first load / refresh) ───────────── */}
          {initialLoading ? (
            <PageLoading minHeight="min-h-[60vh]" />
          ) : null}

          {/* ── Error Banner ─────────────────────────────────────────────── */}
          {loadError ? (
            <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-500/20">
                  <svg className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-orange-600 leading-relaxed">
                    {loadError}
                  </p>
                </div>
                <button
                  type="button"
                  className={cn(buttonVariants({ variant: "secondary" }), "shrink-0")}
                  onClick={() => void fetchAll()}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Cards Bento Grid ─────────────────────────────────────────── */}
          {!initialLoading && !loadError && (
            <section className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-12">
              {/* Profile hero (full width) */}
              <div className="lg:col-span-12">
                <ProfileCard
                  displayName={me?.displayName}
                  username={me?.username}
                  twitterUsername={me?.twitterUsername}
                  avatarUrl={me?.avatarUrl}
                  weeklyRank={loading ? null : s.weeklyRank || null}
                  loading={loading}
                />
              </div>

              {/* CC Holdings — hero utama (lebar) */}
              <div className="lg:col-span-8">
                <CcHoldingsCard hasWallet={hasWallet} />
              </div>

              {/* Stack kanan: Points + Activity */}
              <div className="flex flex-col gap-4 md:gap-5 lg:col-span-4">
                <PointsCard
                  remaining={pointsBalance?.remaining ?? s.pointsRemaining ?? 0}
                  loading={loading}
                />
                <ActivityStatsCard
                  questsDone={s.earnHubCompleted ?? 0}
                  earnDone={s.campaignCompleted ?? 0}
                  onchainTx={s.txCount}
                  loading={loading}
                />
              </div>
            </section>
          )}

          {/* ── Row 3: Live campaigns + recent activity. Widget opsional —
              otomatis tersembunyi saat datanya kosong (mis. belum punya
              wallet atau tidak ada kampanye aktif). ── */}
          {!initialLoading && !loadError && (
            <section className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <LiveCampaignsStrip />
              </div>
              <div className="lg:col-span-5">
                <RecentActivityFeed hasWallet={hasWallet} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
