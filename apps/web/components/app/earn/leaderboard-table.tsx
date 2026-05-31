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
    <td className="px-6 py-4">
      <div className="flex items-center gap-4">
        <div
          className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/10 ring-offset-2 ring-offset-[var(--card)]"
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
          <div className="flex flex-wrap items-center gap-3 gap-y-1">
            <span className="text-base font-semibold text-slate-100">
              {row.displayName}
            </span>
            {isCurrentUser && (
              <span className="rounded-lg bg-[var(--primary)]/20 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-100">
                You
              </span>
            )}
            {row.rank <= 3 && (
              <span className="text-base">
                {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
              </span>
            )}
          </div>
          {row.twitterUsername ? (
            <p className="mt-1 text-sm font-medium text-slate-400">@{row.twitterUsername}</p>
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
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
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

      <div className="overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]">
        <div className="flex items-center gap-3 border-b border-slate-800/80 bg-[var(--muted)]/40 px-6 py-4 text-base font-semibold text-slate-100">
          <Trophy className="h-5 w-5 text-slate-400" />
          Top participants ·{" "}
          {period === "all" ? "All time" : period === "weekly" ? "Weekly" : "Monthly"}
          {data && (
            <span className="ml-auto text-sm font-medium text-slate-400">
              {data.total} participants
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="xl" tone="muted" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-base font-semibold text-slate-100">
              No participants yet
            </p>
            <p className="mt-2 text-sm font-medium text-slate-400">
              Complete quests to appear on the leaderboard.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left">
              <thead className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold">#</th>
                  <th className="min-w-[12rem] px-6 py-4 font-semibold">Participant</th>
                  <th className="whitespace-nowrap px-6 py-4 text-right font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const isCurrentUser = row.userId === currentUserId;
                  return (
                    <tr
                      key={row.userId}
                      className={cn(
                        "border-t border-slate-800/80",
                        isCurrentUser && "bg-[var(--primary)]/6",
                      )}
                    >
                      <td className="px-6 py-4 text-base tabular-nums font-semibold text-slate-100">
                        {row.rank}
                      </td>
                      <ParticipantCell row={row} isCurrentUser={isCurrentUser} />
                      <td className="px-6 py-4 text-right text-base tabular-nums font-semibold text-slate-100">
                        {row.points.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <ListPagination
            className="px-6 pb-4"
            page={page}
            totalPages={totalPages}
            total={data?.total}
            disabled={loading}
            onPageChange={changePage}
          />
        )}
      </div>
    </div>
  );
}
