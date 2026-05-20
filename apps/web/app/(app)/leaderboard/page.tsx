import { LeaderboardTable } from "@/components/app/leaderboard-table";

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Rankings
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          Compete weekly, monthly, or all time
        </h2>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Earn points by completing verified quest tasks. Weekly resets every Monday, monthly every 1st.
          Your row is highlighted when logged in.
        </p>
      </div>
      <LeaderboardTable />
    </div>
  );
}
