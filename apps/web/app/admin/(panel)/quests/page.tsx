import { Gift } from "lucide-react";
import { AdminQuestHubPanel } from "@/components/admin/admin-quest-hub-panel";
import { adminServerFetch } from "@/lib/auth/admin-server-fetch";
import type { QuestHub } from "@/components/admin/admin-quest-hub-tasks-panel";

async function fetchQuestHub(): Promise<QuestHub | null> {
  // earn-hub merespon 404 saat belum ada hub — treat as null (panel akan
  // menawarkan tombol setup), bukan error.
  const data = await adminServerFetch<QuestHub | { message?: string }>(
    "/earn-hub",
  );
  if (!data || typeof data !== "object" || !("id" in data)) return null;
  return data as QuestHub;
}

/** Admin — CanQuest Earn hub (user menu Quest) */
export default async function AdminQuestHubPage() {
  const hub = await fetchQuestHub();

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-600">
          <Gift className="h-3.5 w-3.5" />
          User menu: Quest
        </div>
        <h1 className="type-page-title">Quest tasks</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Add CanQuest tasks only — check-in, Twitter, Telegram, Discord, and quizzes. No campaign
          banners or invite codes (those are under <strong>Earn</strong>).
        </p>
      </div>

      <AdminQuestHubPanel initialHub={hub} />
    </div>
  );
}
