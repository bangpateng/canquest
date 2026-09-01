"use client";

import { EarnCampaignSkeleton } from "@/components/app/earn/earn-campaign-skeleton";
import { EarnCampaignCard } from "@/components/app/earn/earn-campaign-card";
import type { Quest, QuestStatus, UserProgress } from "@/lib/quest/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { ListPagination } from "@/components/app/list/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // "ALL" = gabungan semua status (opsi pertama dropdown).
  type StatusFilter = QuestStatus | "ALL";
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
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
    () =>
      allQuests.filter(
        (q) => (status === "ALL" || q.status === status) && matchesSearch(q, query),
      ),
    [allQuests, status, query],
  );

  useEffect(() => {
    setPage(1);
  }, [status, query]);

  // Tutup dropdown status saat klik luar (mirror toolbar Ecosystem).
  useEffect(() => {
    if (!ddOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) {
        setDdOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ddOpen]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedQuests = filtered.slice((page - 1) * pageSize, page * pageSize);

  const statusLabel = (id: StatusFilter) =>
    id === "ALL" ? "All statuses" : QUEST_STATUS_BADGE[id].label;
  const statusCount = (id: StatusFilter) =>
    id === "ALL" ? allQuests.length : counts[id];

  return (
    <div className={cn("w-full max-w-full overflow-hidden", isEarn ? "space-y-4 sm:space-y-5 md:space-y-6" : "space-y-5 sm:space-y-6 md:space-y-8")}>
      {isEarn ? (
        <>
          {/* ── Hero header ─────────────────────────────────────────────── */}
          <Card className="w-full overflow-hidden">
            <div className="p-6 sm:p-7">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("earnCampaigns.kindCampaign")}
              </p>
              <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-3xl md:text-4xl">
                Earn Rewards
              </h1>
              <p className="mt-2 max-w-md text-xs font-medium leading-relaxed text-[var(--muted-foreground)] sm:text-sm">
                Complete partner quests and claim your early access codes, invite passes, and special rewards
              </p>
            </div>
          </Card>

          {/* ── Toolbar: search + dropdown status (mirror Ecosystem) ── */}
          <section aria-label={t("earnCampaigns.filterAria")} className="w-full">
            <Card bare className="relative w-full p-3 sm:p-4" ref={ddRef}>
              <div className="flex w-full items-center gap-2.5 sm:gap-3">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 transition-colors focus-within:border-[rgb(111_230_0/0.45)] sm:h-11 sm:px-4">
                  <Search className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search campaigns…"
                    className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setDdOpen((v) => !v)}
                  className={cn(
                    "flex h-10 shrink-0 items-center justify-between gap-2 rounded-xl border bg-[var(--card)] px-3 text-[13px] font-semibold transition-colors sm:h-11 sm:gap-2.5 sm:px-3.5 sm:text-sm",
                    ddOpen
                      ? "border-[rgb(111_230_0/0.45)]"
                      : "border-[var(--border)] hover:border-[rgb(111_230_0/0.35)]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--primary)]" />
                    <span className="max-w-[110px] truncate sm:max-w-[150px]">
                      {statusLabel(status)}
                    </span>
                    <span className="hidden tabular-nums text-[var(--muted-foreground)] sm:inline">
                      ({statusCount(status)})
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200",
                      ddOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
              {ddOpen && (
                <div className="absolute inset-x-3 top-[calc(100%-4px)] z-40 max-h-[280px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[0_12px_32px_-12px_rgb(13_20_32/0.25)] sm:inset-x-4">
                  {(
                    ["ALL", ...TABS.map((tab) => tab.id)] as StatusFilter[]
                  ).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setStatus(id);
                        setDdOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-[rgb(111_230_0/0.10)]",
                        status === id
                          ? "font-semibold text-canton"
                          : "font-medium text-[var(--foreground)]",
                      )}
                    >
                      {statusLabel(id)}
                      <span className="ml-auto text-[11px] tabular-nums text-[var(--muted-foreground)]">
                        {statusCount(id)}
                      </span>
                      {status === id && (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
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
          <p className="text-lg font-bold tracking-tight text-red-600 sm:text-xl md:text-2xl">
            {t("earnCampaigns.loadFailed")}
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-red-600/70 sm:mt-3 sm:text-base">
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
