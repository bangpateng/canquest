"use client";

import { EarnCampaignSkeleton } from "@/components/app/earn/earn-campaign-skeleton";
import { EarnCampaignCard } from "@/components/app/earn/earn-campaign-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest/quest-types";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { resolveQuestMediaUrl } from "@/lib/quest/quest-media-url";

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

export function QuestsBrowser({ variant = "earn" }: { variant?: "default" | "earn" }) {
  const t = usePlatformT();
  const isEarn = variant === "earn";
  const pageSize = EARN_PAGE_SIZE;

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
        isEarn ? "gap-1.5" : "gap-2 pb-1 sm:pb-0",
      )}
    >
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
  );

  return (
    <div className={cn("w-full max-w-full overflow-hidden", isEarn ? "space-y-4 sm:space-y-5 md:space-y-6" : "space-y-5 sm:space-y-6 md:space-y-8")}>
      {isEarn ? (
        <>
          {/* ── Hero header ─────────────────────────────────────────────── */}
          <Card className="w-full overflow-hidden">
            <div className="p-6 sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("earnCampaigns.kindCampaign")}
              </p>
              <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-3xl md:text-4xl">
                Earn Rewards
              </h1>
              <p className="mt-2 max-w-md text-xs font-medium leading-relaxed text-[var(--muted-foreground)] sm:text-sm">
                Complete quests from partner projects to earn CC, tokens, invite codes and early access.
              </p>
            </div>
          </Card>

          {/* ── Toolbar: tabs ──────────────────────────────────── */}
          <section
            aria-label={t("earnCampaigns.filterAria")}
            className="w-full overflow-hidden"
          >
            <Card bare className="w-full overflow-hidden p-3 sm:p-4">
              <div className="min-w-0 flex-1 overflow-hidden">{tabRow}</div>
            </Card>
          </section>
        </>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <EarnCampaignSkeleton key={i} />
          ))}
        </div>
      ) : loadError ? (
        <Card className="px-4 py-10 text-center sm:px-6 sm:py-14">
          <p className="text-lg font-bold tracking-tight text-red-200 sm:text-xl md:text-2xl">
            {t("earnCampaigns.loadFailed")}
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-red-200/70 sm:mt-3 sm:text-base">
            {isWalletRequiredLoadError(loadError)
              ? t("earnCampaigns.loadFailedHint")
              : loadError}
          </p>
          {isEarn && isWalletRequiredLoadError(loadError) ? (
            <Link
              href="/wallet"
              className={cn(buttonVariants({ size: "sm" }), "mt-6 rounded-xl sm:mt-8")}
            >
              {t("dashboard.createWallet")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => loadQuests()}
              className={cn(buttonVariants({ size: "sm" }), "mt-6 rounded-xl sm:mt-8")}
            >
              Retry
            </button>
          )}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed px-4 py-16 text-center sm:px-8 sm:py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
              <Search className="h-8 w-8 text-[var(--muted-foreground)]" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl md:text-2xl">
                {query ? t("quests.noMatch") : t("quests.noPrograms")}
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-relaxed text-[var(--muted-foreground)] sm:mt-3 sm:text-base">
                {query
                  ? t("quests.tryAnother")
                  : allQuests.length === 0
                    ? t("earnCampaigns.noCampaignsHint")
                    : t("earnCampaigns.tryOtherTab")}
              </p>
            </div>
          </div>
          {isEarn && allQuests.length === 0 ? (
            <Link
              href={ROUTES.questHub}
              className={cn(buttonVariants({ size: "sm" }), "mt-6 inline-flex rounded-xl sm:mt-8")}
            >
              {t("earnCampaigns.dailyTasks")}
            </Link>
          ) : null}
        </Card>
      ) : (
        <>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 md:gap-6 xl:grid-cols-3">
            {pagedQuests.map((q) => (
              <div key={q.id} className="w-full overflow-hidden">
                <EarnCampaignCard
                  quest={q}
                  completed={progress?.completedQuestIds.includes(q.id) ?? false}
                  userProgress={progress}
                />
              </div>
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