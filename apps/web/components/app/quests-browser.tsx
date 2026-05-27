"use client";
import { PageLoading } from "@/components/ui/loading-spinner";

import { EarnCampaignSkeleton } from "@/components/app/earn-campaign-skeleton";
import { EarnCampaignCard } from "@/components/app/earn-campaign-card";
import { QuestCard } from "@/components/app/quest-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest-types";
import { filterTabClass } from "@/lib/ui-button-styles";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/app/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/app-routes";
import { resolveQuestMediaUrl } from "@/lib/quest-media-url";

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

export type EarnCampaignStats = {
  active: number;
  completed: number;
  total: number;
};

export function QuestsBrowser({
  embedded = false,
  variant = "default",
  onStatsChange,
}: {
  embedded?: boolean;
  variant?: "default" | "earn";
  onStatsChange?: (stats: EarnCampaignStats) => void;
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
        const active = quests.filter((q) => q.status === "ACTIVE").length;
        const completed = prog?.completedQuestIds?.length ?? 0;
        onStatsChange?.({ active, completed, total: quests.length });

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
        onStatsChange?.({ active: 0, completed: 0, total: 0 });
      })
      .finally(() => setLoading(false));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [onStatsChange]);

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
        "flex gap-1 overflow-x-auto p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        isEarn
          ? "rounded-2xl border border-[var(--border)] bg-[var(--muted)]/25"
          : "gap-2 pb-1 sm:pb-0",
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
              isEarn ? "flex-1 justify-center sm:flex-none" : undefined,
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
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("quests.searchPlaceholder")}
        className={cn(
          "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-3 text-sm outline-none transition-shadow placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          isEarn && "bg-[var(--background)]/80",
        )}
        autoComplete="off"
      />
    </label>
  );

  return (
    <div className={cn("w-full min-w-0", isEarn ? "space-y-4" : "space-y-5")}>
      {isEarn ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="sm:order-2 sm:w-[22rem]">{searchField}</div>
          <div className="sm:order-1 sm:flex-1">{tabRow}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {tabRow}
          {searchField}
        </div>
      )}

      {loading ? (
        isEarn ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <EarnCampaignSkeleton key={i} />
            ))}
          </div>
        ) : (
          <PageLoading minHeight="min-h-0" className="py-14" />
        )
      ) : loadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
          <p className="type-subsection-title text-red-200">{t("earnCampaigns.loadFailed")}</p>
          <p className="mt-2 text-sm text-red-200/80">
            {isWalletRequiredLoadError(loadError)
              ? t("earnCampaigns.loadFailedHint")
              : loadError}
          </p>
          {isEarn && isWalletRequiredLoadError(loadError) ? (
            <Link href="/wallet" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
              {t("dashboard.createWallet")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => loadQuests()}
              className={cn(buttonVariants({ size: "sm" }), "mt-4")}
            >
              {t("spin.retry")}
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className={cn(
            "px-6 py-14 text-center",
            isEarn
              ? "rounded-2xl border border-dashed border-[var(--border)] bg-[var(--muted)]/15"
              : "rounded-2xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30",
          )}
        >
          <p className="type-subsection-title text-[var(--foreground)]">
            {query ? t("quests.noMatch") : t("quests.noPrograms")}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {query
              ? t("quests.tryAnother")
              : allQuests.length === 0
                ? t("earnCampaigns.noCampaignsHint")
                : t("earnCampaigns.tryOtherTab")}
          </p>
          {isEarn && allQuests.length === 0 ? (
            <Link
              href={ROUTES.earnHub}
              className={cn(buttonVariants({ size: "sm" }), "mt-4 inline-flex")}
            >
              {t("earnCampaigns.dailyTasks")}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {isEarn ? (
            <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {pagedQuests.map((q) => (
                <EarnCampaignCard
                  key={q.id}
                  quest={q}
                  completed={progress?.completedQuestIds.includes(q.id) ?? false}
                  userProgress={progress}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {pagedQuests.map((q) => (
                <QuestCard
                  key={q.id}
                  quest={q}
                  completed={progress?.completedQuestIds.includes(q.id) ?? false}
                />
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
