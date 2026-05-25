"use client";

import { ListPagination } from "@/components/app/list-pagination";
import { filterTabClass } from "@/lib/ui-button-styles";
import { cn } from "@/lib/utils";
import { Loader2, Trophy } from "lucide-react";
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
  points: number;
  avatarUrl: string | null;
}

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

function ParticipantCell({
  row,
  isCurrentUser,
}: {
  row: LeaderboardRow;
  isCurrentUser: boolean;
}) {
  const cacheBust =
    row.avatarUrl && !row.avatarUrl.includes("?")
      ? `${row.avatarUrl}?v=${row.userId}`
      : row.avatarUrl;

  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-3">
        <div
          className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-[var(--border)] ring-offset-2 ring-offset-[var(--card)]"
          aria-hidden
          style={
            cacheBust
              ? undefined
              : { backgroundImage: avatarGradient(row.username) }
          }
        >
          {cacheBust ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cacheBust}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="type-micro-label text-white drop-shadow-sm">
              {getInitials(row.displayName)}
            </span>
          )}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="type-subsection-title text-[var(--foreground)]">
              {row.displayName}
            </span>
            {isCurrentUser && (
              <span className="rounded-md bg-[var(--primary)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--foreground)]">
                You
              </span>
            )}
            {row.rank <= 3 && (
              <span className="text-sm">
                {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
              </span>
            )}
          </div>
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
          `/api/quests/leaderboard?period=${per}&page=${p}&pageSize=${LEADERBOARD_PAGE_SIZE}`,
          { credentials: "include", signal: AbortSignal.timeout(12_000) },
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
    <div className="space-y-4">
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

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-sm font-medium">
          <Trophy className="h-4 w-4 text-[var(--muted-foreground)]" />
          Top participants ·{" "}
          {period === "all" ? "All time" : period === "weekly" ? "Weekly" : "Monthly"}
          {data && (
            <span className="ml-auto text-xs text-[var(--muted-foreground)]">
              {data.total} participants
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">
              No participants yet
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Complete quests to appear on the leaderboard.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">#</th>
                  <th className="min-w-[12rem] px-3 py-2 font-medium">Participant</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const isCurrentUser = row.userId === currentUserId;
                  return (
                    <tr
                      key={row.userId}
                      className={cn(
                        "border-t border-[var(--border)]",
                        isCurrentUser && "bg-[var(--primary)]/6",
                      )}
                    >
                      <td className="px-3 py-3 text-sm tabular-nums font-medium">
                        {row.rank}
                      </td>
                      <ParticipantCell row={row} isCurrentUser={isCurrentUser} />
                      <td className="px-3 py-3 text-right text-sm tabular-nums font-medium">
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
            className="px-4 pb-3"
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
