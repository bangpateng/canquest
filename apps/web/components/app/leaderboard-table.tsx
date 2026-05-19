"use client";

import {
  getLeaderboardProfile,
  LEADERBOARD_PAGE_SIZE,
  MOCK_LEADERBOARD,
  type MockLeaderRow,
} from "@/lib/mock-demo";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const TABS = [
  { id: "weekly" as const, label: "Weekly" },
  { id: "monthly" as const, label: "Monthly" },
  { id: "all" as const, label: "All time" },
];

function ParticipantCell({ row }: { row: MockLeaderRow }) {
  const p = getLeaderboardProfile(row.handle);

  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-3">
        <div
          className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-[var(--border)] ring-offset-2 ring-offset-[var(--card)]"
          aria-hidden
          style={{ backgroundImage: p.avatarGradient }}
        >
          <span className="font-[family-name:var(--font-space)] text-xs font-bold tracking-tight text-white drop-shadow-sm">
            {p.initials}
          </span>
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="font-[family-name:var(--font-space)] font-semibold text-[var(--foreground)]">
              {p.displayName}
            </span>
            {row.badge ? (
              <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                {row.badge}
              </span>
            ) : null}
          </div>
          <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
            @{row.handle}
          </span>
        </div>
      </div>
    </td>
  );
}

function Row({ row }: { row: MockLeaderRow }) {
  return (
    <tr
      className={cn(
        "border-t border-[var(--border)]",
        row.badge === "You" && "bg-[var(--primary)]/6",
      )}
    >
      <td className="px-3 py-3 text-sm tabular-nums font-medium">{row.rank}</td>
      <ParticipantCell row={row} />
      <td className="px-3 py-3 text-right text-sm tabular-nums font-medium">
        {row.points.toLocaleString()}
      </td>
      <td className="hidden px-3 py-3 text-right text-sm text-canton-muted sm:table-cell">
        {row.change}
      </td>
    </tr>
  );
}

export function LeaderboardTable() {
  const [period, setPeriod] = useState<(typeof TABS)[number]["id"]>("weekly");
  const [page, setPage] = useState(1);
  const rows = MOCK_LEADERBOARD[period];

  const totalPages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    setPage(1);
  }, [period]);

  const { pageRows, rangeStart, rangeEnd } = useMemo(() => {
    const start = (currentPage - 1) * LEADERBOARD_PAGE_SIZE;
    return {
      pageRows: rows.slice(start, start + LEADERBOARD_PAGE_SIZE),
      rangeStart: rows.length ? start + 1 : 0,
      rangeEnd: Math.min(start + LEADERBOARD_PAGE_SIZE, rows.length),
    };
  }, [rows, currentPage]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPeriod(t.id)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              period === t.id
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-sm font-medium">
          <Trophy className="h-4 w-4 text-[var(--muted-foreground)]" />
          Top participants ·{" "}
          {period === "all" ? "All time" : period.charAt(0).toUpperCase() + period.slice(1)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-medium">#</th>
                <th className="min-w-[12rem] px-3 py-2 font-medium">Participant</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Pts</th>
                <th className="hidden whitespace-nowrap px-3 py-2 text-right font-medium sm:table-cell">
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <Row key={`${period}-${row.rank}-${row.handle}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {rangeStart}–{rangeEnd} of {rows.length}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className={cn(
                  "inline-flex items-center gap-1 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors",
                  currentPage <= 1
                    ? "cursor-not-allowed opacity-40"
                    : "bg-[var(--card)] hover:bg-[var(--muted)]",
                )}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Prev
              </button>
              <div className="flex flex-wrap items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={cn(
                      "min-h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors",
                      n === currentPage
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className={cn(
                  "inline-flex items-center gap-1 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors",
                  currentPage >= totalPages
                    ? "cursor-not-allowed opacity-40"
                    : "bg-[var(--card)] hover:bg-[var(--muted)]",
                )}
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
