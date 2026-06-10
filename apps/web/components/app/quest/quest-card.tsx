"use client";
import Link from "next/link";
import type { Quest } from "@/lib/quest/quest-types";
import { ROUTES } from "@/lib/routing/app-routes";
import { cn } from "@/lib/utils/utils";
import { Clock } from "lucide-react";

export function QuestCard({ quest, completed = false }: { quest: Quest; completed?: boolean }) {
  return (
    <Link href={ROUTES.campaignQuest(quest.id, quest.title)} className="block h-full">
      <div className={cn("group relative flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-shadow hover:border-[var(--primary)]/20", completed && "opacity-70")}>
        {quest.bannerImageUrl && <div className="h-28 bg-cover bg-center" style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }} />}
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-center gap-2.5">
            {quest.logoUrl ? <img src={quest.logoUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
            : <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--muted)] text-xs font-bold text-canton">{quest.orgSlug.slice(0,2).toUpperCase()}</div>}
            <div className="min-w-0"><p className="text-xs text-[var(--muted-foreground)]">{quest.org}</p><h3 className="text-sm font-semibold text-[var(--foreground)] line-clamp-1">{quest.title}</h3></div>
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)] line-clamp-2">{quest.description}</p>
          <div className="mt-auto pt-3 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>{quest.tasks.length} tasks</span>
            {quest.endsAt && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(quest.endsAt).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}