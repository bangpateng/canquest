"use client";
import { PageLoading } from "@/components/ui/loading-spinner";

import { EarnCampaignSkeleton } from "@/components/app/earn/earn-campaign-skeleton";
import { EarnCampaignCard } from "@/components/app/earn/earn-campaign-card";
import { QuestCard } from "@/components/app/quest/quest-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest/quest-types";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { inputClass, surfaceToolbarClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { CheckCircle2, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { resolveQuestMediaUrl } from "@/lib/quest/quest-media-url";

const QUEST_PAGE_SIZE = 6;
const EARN_PAGE_SIZE = 6;

function isWalletRequiredLoadError(message: string | null): boolean {
  if (!message) return false;
  return /canton wallet/i.test(message) || /wallet first/i.test(message);
}

const TABS: { id: QuestStatus; label: string }[] = [
  { id: "ACTIVE", label: "Active" },
  { id: "COMING_SOON", label: "Coming soon" },
  { id: "ENDED", label: "Ended" },
];

function normalizeQuestMedia(quest: Quest): Quest {
  return {
    ...quest,
    bannerImageUrl: resolveQuestMediaUrl(quest.bannerImageUrl),
    logoUrl: resolveQuestMediaUrl(quest.logoUrl),
  };
}

function matchesSearch(quest: Quest, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [quest.title, quest.org, quest.description, quest.rewardPool, quest.deadline ?? "", ...quest.tags]
    .join(" ")
    .toLowerCase()
    .includes(s);
}

export function QuestsBrowser({
  embedded = false,
  variant = "default",
}: {
  embedded?: boolean;
  variant?: "default" | "earn";
}) {
  const t = usePlatformT();
  const isEarn = variant === "earn" || embedded;
  const pageSize = isEarn ? EARN_PAGE_SIZE : QUEST_PAGE_SIZE;

  const [status, setStatus] = useState<QuestStatus>("ACTIVE");
  const [query, setQuery] = useState("");
  const [allQuests, setAllQuests] = useState<Quest[]>([]);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [completionStats, setCompletionStats] = useState({ completed: 0, total: 0 });

  const loadQuests = useCallback(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetch("/api/quests", { credentials: "include", signal: controller.signal }).then(
        async (r) => {
          const data = (await r.json().catch(() => ({}))) as Quest[] | { message?: string };
          if (!r.ok) {
            if (r.status === 429) {
              throw new Error("Too many requests — wait a few seconds and refresh.");
            }
            if (r.status === 403) {
              throw new Error(
                typeof data === "object" &&
                  data !== null &&
                  "message" in data &&
                  typeof data.message === "string"
                  ? data.message
                  : "Please create your Canton wallet first to access Earn.",
              );
            }
            const msg =
              typeof data === "object" &&
              data !== null &&
              "message" in data &&
              typeof data.message === "string"
                ? data.message
                : `Could not load campaigns (${r.status})`;
            throw new Error(msg);
          }
          return Array.isArray(data) ? data.map(normalizeQuestMedia) : [];
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
        const completed = prog?.completedQuestIds?.length ?? 0;
        setCompletionStats({ completed, total: quests.length });

        if (quests.length > 0) {
          const activeCount = quests.filter((q) => q.status === "ACTIVE").length;
          if (activeCount === 0) {
            const fallback = TABS.find((tab) => quests.some((q) => q.status === tab.id));
            if (fallback) setStatus(fallback.id);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          setLoadError(
            "Request timed out — is the API running on port 3001? (First load after restart can take up to 30s.)",
          );
        } else if (err instanceof Error) {
          setLoadError(err.message);
        } else {
          setLoadError("Could not load campaigns");
        }
        setAllQuests([]);
        setCompletionStats({ completed: 0, total: 0 });
      })
      .finally(() => setLoading(false));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const cleanup = loadQuests();
    return cleanup;
  }, [loadQuests]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedQuests = filtered.slice((page - 1) * pageSize, page * pageSize);

  const tabRow = (
    <div
      className={cn(
        "flex overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        isEarn ? "gap-2" : "gap-2 pb-1 sm:pb-0",
      )}
    >
      {TABS.map((tab) => {
        const selected = status === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatus(tab.id)}
            className={filterTabClass(
              selected,
              isEarn
                ? "justify-center px-3 py-1.5 text-xs sm:px-3.5 sm:py-2 sm:text-sm"
                : undefined,
            )}
          >
            {QUEST_STATUS_BADGE[tab.id].label}{" "}
            <span className="tabular-nums opacity-80">({counts[tab.id]})</span>
          </button>
        );
      })}
    </div>
  );

  const searchField = (
    <label
      className={cn(
        "relative block w-full shrink-0",
        isEarn ? "max-w-none" : "sm:max-w-xs",
      )}
    >
      <span className="sr-only">{t("quests.searchLabel")}</span>
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        className={cn(
          "w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 py-3 pl-12 pr-4 text-base font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-[var(--primary)]/40 focus:ring-2 focus:ring-[var(--ring)]",
          isEarn && "bg-[var(--background)]/80",
        )}
        autoComplete="off"
      />
    </label>
  );

  const completionChip =
    isEarn && completionStats.total > 0 ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {completionStats.completed}/{completionStats.total}
      </span>
    ) : null;

  return (
    <div 
      className={cn("w-full min-w-0 max-w-full overflow-x-hidden", isEarn ? "space-y-6 md:space-y-8" : "space-y-8 md:space-y-10")} 
      style={{ 
        maxWidth: '100vw', 
        overflowX: 'hidden',
        contain: 'layout style paint'
      }}
    >
      {isEarn ? (
        <section
          className={cn("w-full max-w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900/40 p-3 sm:p-5 md:p-6", surfaceToolbarClass)}
          aria-label={t("earnCampaigns.filterAria")}
          style={{ maxWidth: '100%', overflow: 'hidden', contain: 'layout style paint' }}
        >
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:gap-4 md:gap-6">
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:gap-3">
              <div className="min-w-0 flex-1 overflow-hidden sm:flex-none">{tabRow}</div>
              {completionChip}
            </div>
            <div className="w-full sm:ml-auto sm:w-72 md:w-80 sm:shrink-0">{searchField}</div>
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          {tabRow}
          {searchField}
        </div>
      )}

      {loading ? (
        isEarn ? (
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <EarnCampaignSkeleton key={i} />
            ))}
          </div>
        ) : (
          <PageLoading minHeight="min-h-0" className="py-20" />
        )
      ) : loadError ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/5 px-6 py-12 text-center backdrop-blur-xl sm:py-14">
          <p className="text-xl font-bold tracking-tight text-red-200 sm:text-2xl">{t("earnCampaigns.loadFailed")}</p>
          <p className="mt-3 text-sm font-medium leading-relaxed text-red-200/70 sm:text-base">
            {isWalletRequiredLoadError(loadError)
              ? t("earnCampaigns.loadFailedHint")
              : loadError}
          </p>
          {isEarn && isWalletRequiredLoadError(loadError) ? (
            <Link href="/wallet" className={cn(buttonVariants({ size: "sm" }), "mt-8 rounded-2xl")}>
              {t("dashboard.createWallet")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => loadQuests()}
              className={cn(buttonVariants({ size: "sm" }), "mt-8 rounded-2xl")}
            >
              {t("spin.retry")}
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className={cn(
            "rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] px-8 py-20 text-center backdrop-blur-xl",
          )}
        >
          <p className="text-xl font-bold tracking-tight text-slate-100 sm:text-2xl">
            {query ? t("quests.noMatch") : t("quests.noPrograms")}
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed text-slate-500 sm:text-base">
            {query
              ? t("quests.tryAnother")
              : allQuests.length === 0
                ? t("earnCampaigns.noCampaignsHint")
                : t("earnCampaigns.tryOtherTab")}
          </p>
          {isEarn && allQuests.length === 0 ? (
            <Link
              href={ROUTES.earnHub}
              className={cn(buttonVariants({ size: "sm" }), "mt-8 inline-flex rounded-2xl")}
            >
              {t("earnCampaigns.dailyTasks")}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {isEarn ? (
            <div 
              className="grid w-full min-w-0 grid-cols-1 items-stretch gap-4 px-1 sm:grid-cols-2 sm:gap-6 sm:px-0 xl:grid-cols-3" 
              style={{ 
                maxWidth: '100%', 
                overflow: 'hidden', 
                width: '100%',
                contain: 'layout style paint'
              }}
            >
              {pagedQuests.map((q) => (
                <div 
                  key={q.id} 
                  className="w-full min-w-0 overflow-hidden" 
                  style={{ 
                    maxWidth: '100%', 
                    width: '100%', 
                    overflow: 'hidden', 
                    wordBreak: 'break-word',
                    contain: 'layout style paint'
                  }}
                >
                  <EarnCampaignCard
                    quest={q}
                    completed={progress?.completedQuestIds.includes(q.id) ?? false}
                    userProgress={progress}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div 
              className="grid w-full min-w-0 grid-cols-1 gap-5 px-1 sm:grid-cols-2 sm:gap-8 sm:px-0 xl:grid-cols-3" 
              style={{ 
                maxWidth: '100%', 
                overflow: 'hidden', 
                width: '100%',
                contain: 'layout style paint'
              }}
            >
              {pagedQuests.map((q) => (
                <div 
                  key={q.id} 
                  className="w-full min-w-0 overflow-hidden" 
                  style={{ 
                    maxWidth: '100%', 
                    width: '100%', 
                    overflow: 'hidden', 
                    wordBreak: 'break-word',
                    contain: 'layout style paint'
                  }}
                >
                  <QuestCard
                    quest={q}
                    completed={progress?.completedQuestIds.includes(q.id) ?? false}
                  />
                </div>
              ))}
            </div>
          )}
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
