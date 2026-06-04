"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles, RefreshCw } from "lucide-react";
import { AdminQuestTable, type AdminQuestRow } from "@/components/admin/admin-quest-table";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function AdminEarnPage() {
  const [quests, setQuests] = useState<AdminQuestRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/quests?kind=CAMPAIGN", { cache: "no-store" });
      if (!res.ok) {
        setError("Failed to load campaigns.");
        return;
      }
      setQuests((await res.json()) as AdminQuestRow[]);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/quests/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message ?? "Delete failed");
    }
    // Refresh list after successful delete
    await load();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-canton">
            <Sparkles className="h-3.5 w-3.5" />
            User menu: Earn
          </div>
          <h1 className="type-page-title">Earn campaigns</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Partner quests — banner, tasks, rewards, invite codes, and winners.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
          <Link href="/admin/earn/new" className={cn(buttonVariants(), "gap-2")}>
            <Plus className="h-4 w-4" />
            New campaign
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
          {error}
        </div>
      )}

      {loading && !quests ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="xl" tone="muted" />
        </div>
      ) : (
        <AdminQuestTable
          quests={quests}
          emptyHref="/admin/earn/new"
          emptyLabel="Create your first campaign"
          showWinners
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
