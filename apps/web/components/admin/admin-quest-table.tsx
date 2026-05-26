import Link from "next/link";

export interface AdminQuestRow {
  id: string;
  title: string;
  projectName?: string | null;
  org: string;
  status: string;
  rewardCc: number;
  rewardType: string;
  maxWinners: number | null;
  codesRemaining?: number;
  _count: { completions: number; inviteCodes?: number };
}

const statusColor: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  COMING_SOON: "bg-[rgb(var(--canton-cyan-rgb)/0.12)] text-[rgb(var(--canton-cyan-rgb)/0.9)]",
  ENDED: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export function AdminQuestTable({
  quests,
  emptyHref,
  emptyLabel,
  showWinners = true,
}: {
  quests: AdminQuestRow[] | null;
  emptyHref: string;
  emptyLabel: string;
  showWinners?: boolean;
}) {
  if (!quests || quests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
        <p className="font-semibold text-[var(--muted-foreground)]">Nothing here yet</p>
        <Link
          href={emptyHref}
          className="mt-3 inline-block text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
        >
          {emptyLabel}
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
            <th className="px-5 py-3 font-semibold">Campaign</th>
            <th className="px-4 py-3 font-semibold">Project</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Reward</th>
            <th className="px-4 py-3 font-semibold">Completions</th>
            <th className="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quests.map((q, i) => (
            <tr
              key={q.id}
              className={i % 2 === 0 ? "bg-[var(--card)]" : "bg-[var(--muted)]/20"}
            >
              <td className="px-5 py-3">
                <p className="font-semibold">{q.title}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{q.org}</p>
              </td>
              <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                {q.projectName?.trim() || "—"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusColor[q.status] ?? ""}`}
                >
                  {q.status}
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums">
                <span className="font-medium">{q.rewardCc} CC</span>
                {q.rewardType !== "CC_ONLY" && (
                  <span className="ml-1 text-xs text-[var(--muted-foreground)]">+ codes</span>
                )}
                {q.maxWinners ? (
                  <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                    ({q.maxWinners} max)
                  </span>
                ) : null}
                {typeof q.codesRemaining === "number" &&
                (q.rewardType.includes("INVITE") || q.rewardType === "CC_AND_INVITE") ? (
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Sisa kode: {q.codesRemaining}
                    {q._count.inviteCodes != null ? ` / ${q._count.inviteCodes}` : ""}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3 tabular-nums text-[var(--muted-foreground)]">
                {q._count.completions}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/quests/${q.id}`}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                  >
                    Manage
                  </Link>
                  {showWinners ? (
                    <Link
                      href={`/admin/quests/${q.id}/winners`}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                    >
                      Winners
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
