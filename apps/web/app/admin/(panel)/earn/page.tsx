import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cookies } from "next/headers";
import { Plus, Sparkles } from "lucide-react";
import { CQ_ADMIN_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { internalApiBase } from "@/lib/internal-api-url";
import { AdminQuestTable, type AdminQuestRow } from "@/components/admin/admin-quest-table";

async function fetchCampaigns(): Promise<AdminQuestRow[] | null> {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${internalApiBase()}/admin/quests?kind=CAMPAIGN`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<AdminQuestRow[]>;
  } catch {
    return null;
  }
}

/** Admin — partner campaigns shown in user menu Earn */
export default async function AdminEarnPage() {
  const quests = await fetchCampaigns();

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
            Partner quests (Alpend, etc.) — banner, tasks, rewards, invite codes, and winners.
          </p>
        </div>
        <Link
          href="/admin/earn/new"
          className={cn(buttonVariants(), "gap-2")}
        >
          <Plus className="h-4 w-4" />
          New campaign
        </Link>
      </div>

      <AdminQuestTable
        quests={quests}
        emptyHref="/admin/earn/new"
        emptyLabel="Create your first campaign"
        showWinners
      />
    </div>
  );
}
