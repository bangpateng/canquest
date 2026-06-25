"use client";

import Link from "next/link";
import { useState } from "react";
import { Trash2, Pencil, Trophy, AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/utils";

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

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  ACTIVE: {
    label: "Active",
    cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25",
    icon: CheckCircle2,
  },
  COMING_SOON: {
    label: "Coming Soon",
    cls: "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25",
    icon: Clock,
  },
  ENDED: {
    label: "Ended",
    cls: "bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25",
    icon: XCircle,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ENDED!;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cfg.cls)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

export function AdminQuestTable({
  quests,
  emptyHref,
  emptyLabel,
  showWinners = true,
  onDelete,
}: {
  quests: AdminQuestRow[] | null;
  emptyHref: string;
  emptyLabel: string;
  showWinners?: boolean;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(quest: AdminQuestRow) {
    if (
      !confirm(
        `Delete campaign "${quest.title}"?\n\nThis will permanently remove the quest and all its data (tasks, completions, winners). This cannot be undone.`,
      )
    )
      return;

    setDeletingId(quest.id);
    setDeleteError(null);
    try {
      if (onDelete) {
        await onDelete(quest.id);
      } else {
        const res = await fetch(`/api/admin/quests/${quest.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string };
          setDeleteError(data.message ?? "Delete failed. Try again.");
        }
      }
    } catch {
      setDeleteError("Network error. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

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
    <div className="space-y-3">
      {deleteError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm font-medium text-red-400">{deleteError}</p>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            ×
          </button>
        </div>
      )}

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
                className={cn(
                  "transition-colors",
                  i % 2 === 0 ? "bg-[var(--card)]" : "bg-[var(--muted)]/20",
                  deletingId === q.id && "opacity-50",
                )}
              >
                <td className="px-5 py-3">
                  <p className="font-semibold">{q.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{q.org}</p>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  {q.projectName?.trim() || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={q.status} />
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
                  q.rewardType.includes("INVITE") ? (
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      Codes left: {q.codesRemaining}
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
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                    >
                      <Pencil className="h-3 w-3" />
                      Manage
                    </Link>
                    {showWinners ? (
                      <Link
                        href={`/admin/quests/${q.id}/winners`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                      >
                        <Trophy className="h-3 w-3" />
                        Winners
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleDelete(q)}
                      disabled={deletingId === q.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === q.id ? (
                        <span className="text-[10px]">Deleting…</span>
                      ) : (
                        <>
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </>
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
