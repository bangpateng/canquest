"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { ListPagination } from "@/components/app/list/list-pagination";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const LEADERBOARD_PAGE_SIZE = 5;

const TABS = [
  { id: "weekly" as const, label: "Weekly" },
  { id: "monthly" as const, label: "Monthly" },
  { id: "all" as const, label: "All time" },
];

interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  twitterUsername?: string | null;
  points: number;
  avatarUrl: string | null;
}

const LEADERBOARD_AVATAR_PX = 48;

interface LeaderboardData {
  rows: LeaderboardRow[];
  total: number;
  page: number;
  pageSize: number;
}

function getInitials(displayName: string): string {
  return displayName
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #d4ff3f 0%, #8b9c0d 100%)",
  "linear-gradient(145deg, #60a5fa 0%, #1d4ed8 100%)",
  "linear-gradient(145deg, #f472b6 0%, #9333ea 100%)",
  "linear-gradient(145deg, #34d399 0%, #0d9488 100%)",
  "linear-gradient(145deg, #fb923c 0%, #c2410c 100%)",
  "linear-gradient(145deg, #a78bfa 0%, #6d28d9 100%)",
  "linear-gradient(145deg, #38bdf8 0%, #0369a1 100%)",
  "linear-gradient(145deg, #fbbf24 0%, #d97706 100%)",
];

function avatarGradient(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
}

/** Twitter CDN URLs must not get extra query params (breaks CDN / optimizers). */
function leaderboardAvatarSrc(url: string | null): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.includes("twimg.com")) return trimmed;
  return trimmed;
}

function ParticipantCell({
  row,
  isCurrentUser,
}: {
  row: LeaderboardRow;
  isCurrentUser: boolean;
}) {
  const avatarSrc = leaderboardAvatarSrc(row.avatarUrl);

  return (
    <td className="px-4 py-3.5 sm:px-6 sm:py-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/10 ring-offset-1 ring-offset-[var(--card)] sm:h-12 sm:w-12"
          aria-hidden
          style={
            avatarSrc
              ? undefined
              : { backgroundImage: avatarGradient(row.username) }
          }
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt=""
              width={LEADERBOARD_AVATAR_PX}
              height={LEADERBOARD_AVATAR_PX}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-xs font-bold uppercase tracking-wider text-white drop-shadow-sm">
              {getInitials(row.displayName)}
            </span>
          )}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="text-sm font-semibold text-slate-100 sm:text-base">
              {row.displayName}
            </span>
            {isCurrentUser && (
              <span className="rounded-md bg-[var(--primary)]/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-100">
                You
              </span>
            )}
            {row.rank <= 3 && (
              <span className="text-sm sm:text-base">
                {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
              </span>
            )}
          </div>
          {row.twitterUsername ? (
            <p className="mt-0.5 text-xs font-medium text-slate-500 sm:text-sm">@{row.twitterUsername}</p>
          ) : null}
        </div>
      </div>
    </td>
  );
}

export function LeaderboardTable() {
  const [period, setPeriod] = useState<"weekly" | "monthly" | "all">("weekly");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get current user ID for highlighting
  useEffect(() => {
    fetch("/api/me", { credentials: "include", signal: AbortSignal.timeout(12_000) })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { id?: string } | null) => { if (d?.id) setCurrentUserId(d.id); })
      .catch(() => {});
  }, []);

  const fetchLeaderboard = useCallback(
    async (p: number, per: typeof period) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/leaderboard?period=${per}&page=${p}&pageSize=${LEADERBOARD_PAGE_SIZE}`,
          { cache: "no-store", signal: AbortSignal.timeout(12_000) },
        );
        if (res.ok) setData((await res.json()) as LeaderboardData);
        else setData({ rows: [], total: 0, page: p, pageSize: LEADERBOARD_PAGE_SIZE });
      } catch {
        setData({ rows: [], total: 0, page: p, pageSize: LEADERBOARD_PAGE_SIZE });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setPage(1);
    void fetchLeaderboard(1, period);
  }, [period, fetchLeaderboard]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / (data.pageSize || LEADERBOARD_PAGE_SIZE)))
    : 1;

  function changePage(newPage: number) {
    setPage(newPage);
    void fetchLeaderboard(newPage, period);
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-5 md:space-y-6 font-sans">
      {/* Period Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const selected = period === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPeriod(t.id)}
              className={filterTabClass(selected)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Leaderboard Card */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-white/[0.05] bg-white/[0.02] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/20">
              <Trophy className="h-5 w-5 text-[var(--primary)]" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold tracking-tight text-white">
                Top participants
              </h2>
              <p className="text-xs sm:text-sm font-medium text-slate-500">
                {period === "all" ? "All time" : period === "weekly" ? "Weekly" : "Monthly"}
              </p>
            </div>
          </div>
          {data && (
            <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 sm:ml-auto">
              {data.total} participants
            </span>
          )}
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20 sm:py-24 md:py-28">
            <LoadingSpinner size="xl" tone="muted" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-5 py-20 sm:py-24 md:py-28 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                <Trophy className="h-8 w-8 text-slate-500" />
              </div>
              <div>
                <p className="text-base sm:text-lg font-semibold text-slate-100">
                  No participants yet
                </p>
                <p className="mt-2 text-xs sm:text-sm font-medium text-slate-500">
                  Complete quests to appear on the leaderboard.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[300px] text-left">
              <thead className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3.5 font-semibold sm:px-6 sm:py-4 md:px-8">#</th>
                  <th className="min-w-[10rem] px-3 py-3.5 font-semibold sm:px-4 sm:py-4">Participant</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-right font-semibold sm:px-6 sm:py-4 md:px-8">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const isCurrentUser = row.userId === currentUserId;
                  return (
                    <tr
                      key={row.userId}
                      className={cn(
                        "border-t border-white/[0.04] transition-all duration-200 hover:bg-white/[0.03]",
                        isCurrentUser && "bg-[var(--primary)]/5 hover:bg-[var(--primary)]/8",
                      )}
                    >
                      <td className="px-4 py-3.5 text-sm sm:text-base tabular-nums font-semibold text-slate-100 sm:px-6 sm:py-4 md:px-8">
                        {row.rank}
                      </td>
                      <ParticipantCell row={row} isCurrentUser={isCurrentUser} />
                      <td className="px-4 py-3.5 text-right text-sm sm:text-base tabular-nums font-bold text-slate-100 sm:px-6 sm:py-4 md:px-8">
                        {row.points.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && data && data.rows.length > 0 && (
          <div className="border-t border-white/[0.05] bg-white/[0.02]">
            <ListPagination
              className="px-5 py-4 sm:px-6 sm:py-5 md:px-8"
              page={page}
              totalPages={totalPages}
              total={data?.total}
              disabled={loading}
              onPageChange={changePage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
