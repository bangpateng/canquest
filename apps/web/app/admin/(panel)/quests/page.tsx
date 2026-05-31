import { cookies } from "next/headers";
import { Gift } from "lucide-react";
import { CQ_ADMIN_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { internalApiBase } from "@/lib/api/internal-api-url";
import { AdminEarnHubPanel } from "@/components/admin/admin-earn-hub-panel";
import type { EarnHubQuest } from "@/components/admin/admin-earn-hub-tasks-panel";

async function fetchEarnHub(): Promise<EarnHubQuest | null> {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${internalApiBase()}/admin/earn-hub`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object" || !("id" in data)) return null;
    return data as EarnHubQuest;
  } catch {
    return null;
  }
}

/** Admin — CanQuest Earn hub (user menu Quest) */
export default async function AdminQuestHubPage() {
  const hub = await fetchEarnHub();

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-300">
          <Gift className="h-3.5 w-3.5" />
          User menu: Quest
        </div>
        <h1 className="type-page-title">Quest tasks</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Add CanQuest tasks only — check-in, Twitter, Telegram, Discord, and quizzes. No campaign
          banners or invite codes (those are under <strong>Earn</strong>).
        </p>
      </div>

      <AdminEarnHubPanel initialHub={hub} />
    </div>
  );
}
