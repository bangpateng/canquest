"use client";

import { QuestCard } from "@/components/app/quest-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest-types";
import { filterTabClass } from "@/lib/ui-button-styles";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/app/list-pagination";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

const QUEST_PAGE_SIZE = 6;

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
  const t = usePlatformT();
  const [status, setStatus] = useState<QuestStatus>("ACTIVE");
  const [query, setQuery] = useState("");
  const [allQuests, setAllQuests] = useState<Quest[]>([]);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch("/api/quests", { credentials: "include", signal: controller.signal }).then(
        async (r) => {
          const data = await r.json();
          if (!r.ok) return [] as Quest[];
          return Array.isArray(data) ? (data as Quest[]) : [];
        },
      ),
      fetch("/api/quests/my-progress", { credentials: "include", signal: controller.signal }).then(
        async (r) => {
          if (!r.ok) return null;
          return r.json() as Promise<UserProgress>;
        },
      ),
    ])
      .then(([quests, prog]) => {
        setAllQuests(quests);
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

  useEffect(() => {
    setPage(1);
  }, [status, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / QUEST_PAGE_SIZE));
  const pagedQuests = filtered.slice(
    (page - 1) * QUEST_PAGE_SIZE,
    page * QUEST_PAGE_SIZE,
  );

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {TABS.map((tab) => {
            const selected = status === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatus(tab.id)}
                className={filterTabClass(selected)}
              >
                {QUEST_STATUS_BADGE[tab.id].label}{" "}
                <span className="tabular-nums opacity-80">({counts[tab.id]})</span>
              </button>
            );
          })}
        </div>
        <label className="relative block w-full shrink-0 sm:max-w-xs">
          <span className="sr-only">{t("quests.searchLabel")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("quests.searchPlaceholder")}
            className="w-full rounded-full border border-[var(--border)] bg-[var(--card)]/80 py-2.5 pl-10 pr-3 text-sm outline-none backdrop-blur-sm transition-shadow placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
          <p className="type-subsection-title text-[var(--foreground)]">
            {t("quests.noMatch")}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {query ? t("quests.tryAnother") : t("quests.noPrograms")}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {pagedQuests.map((q) => (
              <QuestCard
                key={q.id}
                quest={q}
                completed={progress?.completedQuestIds.includes(q.id) ?? false}
              />
            ))}
          </div>
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
