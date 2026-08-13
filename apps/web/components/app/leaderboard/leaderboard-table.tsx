"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Card } from "@/components/ui/card";
import { useMe } from "@/lib/hooks/use-me";

import { ListPagination } from "@/components/app/list/list-pagination";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { Crown, Medal, Trophy } from "lucide-react";
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

function leaderboardAvatarSrc(url: string | null): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.includes("twimg.com")) return trimmed;
  return trimmed;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canton-subtle ring-1 ring-[rgb(var(--canton-rgb)/0.25)]">
        <Crown className="h-5 w-5 text-canton" />
      </span>
    );
  if (rank === 2)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted)]">
        <Medal className="h-5 w-5 text-[var(--foreground)]" />
      </span>
    );
  if (rank === 3)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted)]">
        <Medal className="h-5 w-5 text-canton-muted" />
      </span>
    );
  return <span className="text-sm font-bold tabular-nums text-[var(--muted-foreground)]">{rank}</span>;
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
          className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full sm:h-12 sm:w-12"
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
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)] drop-shadow-sm">
              {getInitials(row.displayName)}
            </span>
          )}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="text-sm font-semibold text-[var(--foreground)] sm:text-base">
              {row.displayName}
            </span>
            {isCurrentUser && (
              <span className="rounded-md bg-canton-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-canton ring-1 ring-[rgb(var(--canton-rgb)/0.20)]">
                You
              </span>
            )}
          </div>
          {row.twitterUsername ? (
            <p className="mt-0.5 text-xs font-medium text-[var(--muted-foreground)] sm:text-sm">
              @{row.twitterUsername}
            </p>
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

  // Profil user via cache global `useMe` (request ter-dedup lintas halaman).
  // Sebelumnya fetch `/api/me` manual hanya untuk membaca `id`.
  const { me: meProfile } = useMe();
  useEffect(() => {
    if (meProfile?.id) setCurrentUserId(meProfile.id);
  }, [meProfile]);

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
      <Card interactive className="w-full max-w-full overflow-hidden">
        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {period === "all" ? "All time" : period === "weekly" ? "Weekly ranking" : "Monthly ranking"}
            </p>
            <h2 className="mt-1 text-base sm:text-lg font-semibold tracking-tight text-[var(--foreground)]">
              Top Participants
            </h2>
          </div>
          {data && (
            <p className="inline-block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] sm:ml-auto">
              {data.total.toLocaleString()} participants
            </p>
          )}
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="relative flex items-center justify-center py-20 sm:py-24 md:py-28">
            <LoadingSpinner size="xl" tone="muted" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="relative px-5 py-20 sm:py-24 md:py-28 text-center">
            <div className="flex flex-col items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-canton-subtle ring-1 ring-[rgb(var(--canton-rgb)/0.15)]">
                <Trophy className="h-8 w-8 text-canton" />
              </span>
              <div>
                <p className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
                  No participants yet
                </p>
                <p className="mt-2 text-xs sm:text-sm font-medium text-[var(--muted-foreground)]">
                  Complete quests to appear on the leaderboard.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative w-full overflow-x-auto">
            <table className="w-full min-w-[300px] text-left">
              <thead className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3.5 font-semibold sm:px-6 sm:py-4 md:px-8">Rank</th>
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
                        "border-t border-[var(--border)] transition-all duration-200 hover:bg-[var(--muted)]/60",
                        isCurrentUser && "bg-canton-subtle/60 hover:bg-canton-subtle",
                      )}
                    >
                      <td className="px-4 py-3.5 sm:px-6 sm:py-4 md:px-8">
                        <RankBadge rank={row.rank} />
                      </td>
                      <ParticipantCell row={row} isCurrentUser={isCurrentUser} />
                      <td className="px-4 py-3.5 text-right sm:px-6 sm:py-4 md:px-8">
                        <span className="text-sm sm:text-base tabular-nums font-extrabold text-[var(--foreground)]">
                          {row.points.toLocaleString()}
                        </span>
                        <span className="ml-1 text-xs font-medium text-[var(--muted-foreground)]">pts</span>
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
          <div className="relative border-t border-[var(--border)]">
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
      </Card>
    </div>
  );
}