"use client";

import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/routing/app-routes";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Coins, Sparkles, Ticket, Trophy } from "lucide-react";
import Link from "next/link";

/** Map accent class from quest-engine config to footer gradient style. */
function accentFooter(accentClass: string): string {
  if (accentClass.includes("violet"))
    return "from-violet-500/10 via-transparent to-transparent border-violet-500/20";
  if (accentClass.includes("cyan"))
    return "from-cyan-500/10 via-transparent to-transparent border-cyan-500/15";
  // Default canton accent
  return "from-[rgb(var(--canton-rgb)/0.08)] via-transparent to-transparent border-[var(--border)]";
}

function CampaignLogo({ quest }: { quest: Quest }) {
  return (
    <div
      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-[var(--muted)]/80"
    >
      {quest.logoUrl ? (
        <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm font-bold text-canton">
          {quest.orgSlug.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export function EarnCampaignRow({
  quest,
  completed = false,
}: {
  quest: Quest;
  completed?: boolean;
}) {
  const t = usePlatformT();

  // ── Derive all UI state from quest-engine ─────────────────────
  const meta = getQuestMeta(quest);
  const { config } = meta;

  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const footer = accentFooter(config.accentClass);

  const ctaLabel =
    quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : t("quests.joinQuest");

  const metaParts = [
    config.shortLabel,
    `${quest.tasks.length} tasks`,
    quest.deadline ?? null,
  ].filter(Boolean) as string[];

  return (
    <li>
      <article
        className={cn(
          "group relative overflow-hidden rounded-3xl border transition-all duration-300",
          completed
            ? "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.06] to-[var(--card)]/90"
            : "border-white/5 bg-[var(--card)]/60 hover:border-[var(--primary)]/20 hover:bg-[var(--card)]/90",
          quest.status === "COMING_SOON" && "opacity-90",
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />

        <div className="p-6">
          {/* Header */}
          <div className="flex gap-5">
          <CampaignLogo quest={quest} />

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 pr-3">
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {quest.org}
                  </p>
                  <h3 className="mt-2 line-clamp-1 text-lg font-bold text-slate-100 sm:text-xl">
                    {quest.title}
                  </h3>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-1 text-xs font-bold uppercase tracking-wide",
                    statusMeta.className,
                  )}
                >
                  {statusMeta.label}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
                {quest.description}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm font-medium leading-relaxed text-slate-400">
                  {metaParts.join(" · ")}
                </p>

                {canOpen ? (
                  <Link
                    href={ROUTES.campaignQuest(quest.id, quest.title)}
                    className={cn(
                      buttonVariants({
                        size: "sm",
                        variant: completed ? "success" : "primary",
                      }),
                      "shrink-0 px-6 font-bold",
                    )}
                  >
                    {ctaLabel}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "shrink-0 cursor-not-allowed rounded-2xl opacity-50",
                    )}
                  >
                    Soon
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reward footer */}
        {canOpen ? (
          <Link
            href={ROUTES.campaignQuest(quest.id, quest.title)}
            className={cn(
              "flex items-center gap-4 border-t bg-gradient-to-r px-6 py-4 transition-colors",
              footer,
              "hover:bg-[var(--muted)]/10",
            )}
          >
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              {t("earnCampaigns.rewardLabel")}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-base font-bold", config.accentClass)}>
              {quest.rewardPool}
            </span>
            <span className="inline-flex shrink-0 items-center text-sm font-semibold text-slate-100 transition-colors group-hover:text-canton">
              {t("quests.viewQuest")}
            </span>
          </Link>
        ) : (
          <div
            className={cn(
              "flex items-center gap-4 border-t bg-gradient-to-r px-6 py-4",
              footer,
            )}
          >
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              {t("earnCampaigns.rewardLabel")}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-base font-bold", config.accentClass)}>
              {quest.rewardPool}
            </span>
          </div>
        )}
      </article>
    </li>
  );
}
