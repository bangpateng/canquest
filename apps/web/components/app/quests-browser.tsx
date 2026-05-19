"use client";

import { QuestCard } from "@/components/app/quest-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const TABS: { id: QuestStatus; label: string }[] = [
  { id: "ACTIVE", label: "Active" },
  { id: "COMING_SOON", label: "Coming soon" },
  { id: "ENDED", label: "Ended" },
];

function matchesSearch(quest: Quest, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [quest.title, quest.org, quest.description, quest.rewardPool, quest.deadline ?? "", ...quest.tags]
    .join(" ")
    .toLowerCase()
    .includes(s);
}

export function QuestsBrowser() {
  const [status, setStatus] = useState<QuestStatus>("ACTIVE");
  const [query, setQuery] = useState("");
  const [allQuests, setAllQuests] = useState<Quest[]>([]);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch("/api/quests", { signal: controller.signal }).then((r) => r.json()),
      fetch("/api/quests/my-progress", { signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([quests, prog]: [Quest[], UserProgress]) => {
        setAllQuests(Array.isArray(quests) ? quests : []);
        setProgress(prog);
      })
      .catch(() => {/* ignore abort */})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const counts = useMemo(() => {
    const c: Record<QuestStatus, number> = { ACTIVE: 0, COMING_SOON: 0, ENDED: 0 };
    for (const q of allQuests) c[q.status]++;
    return c;
  }, [allQuests]);

  const filtered = useMemo(
    () => allQuests.filter((q) => q.status === status && matchesSearch(q, query)),
    [allQuests, status, query],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {TABS.map((tab) => {
            const selected = status === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatus(tab.id)}
                className={cn(
                  "shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  selected
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]",
                )}
              >
                {QUEST_STATUS_BADGE[tab.id].label}{" "}
                <span className="tabular-nums opacity-80">({counts[tab.id]})</span>
              </button>
            );
          })}
        </div>
        <label className="relative block w-full shrink-0 sm:max-w-xs">
          <span className="sr-only">Search quests</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, org, pool…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-3 text-sm outline-none ring-[var(--ring)] transition-shadow placeholder:text-[var(--muted-foreground)] focus-visible:ring-2"
            autoComplete="off"
          />
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-6 py-14 text-center">
          <p className="font-[family-name:var(--font-space)] font-semibold text-[var(--foreground)]">
            No quests match
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {query
              ? `Try another keyword or switch tab.`
              : `No programs in this category yet.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              completed={progress?.completedQuestIds.includes(q.id) ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
