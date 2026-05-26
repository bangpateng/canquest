"use client";

import { CardTitle } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import { EarnCampaignRewardPanel } from "@/components/app/earn-campaign-reward-panel";
import { campaignUiKind } from "@/lib/campaign-reward";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest-types";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";

function QuestLogo({
  logoUrl,
  orgSlug,
  completed,
}: {
  logoUrl?: string | null;
  orgSlug: string;
  completed?: boolean;
}) {
  const inner = logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="h-full w-full object-cover"
    />
  ) : (
    <span className="type-card-title text-canton">
      {orgSlug.slice(0, 2).toUpperCase()}
    </span>
  );

  return (
    <div
      className={cn(
        "relative h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-2 ring-[var(--card)]",
        completed
          ? "bg-emerald-500/15 ring-emerald-500/40"
          : "bg-[var(--muted)] ring-[var(--border)]",
      )}
    >
      <div className="flex h-full w-full items-center justify-center">{inner}</div>
      {completed && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[var(--primary-foreground)] ring-2 ring-[var(--card)]">
          <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function rewardAccent(rewardPool: string, rewardType?: string) {
  const pool = rewardPool.toLowerCase();
  if (rewardType === "CC_ONLY" || rewardType === "CC_AND_INVITE" || pool.includes("cc")) {
    return {
      icon: Coins,
      className: "from-[var(--primary)]/20 to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[var(--primary)]/30 text-canton",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      icon: Ticket,
      className: "from-violet-500/20 to-fuchsia-500/10 border-violet-500/30 text-violet-200",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      icon: Sparkles,
      className: "from-cyan-500/15 to-blue-500/10 border-cyan-500/25 text-cyan-200",
    };
  }
  return {
    icon: Trophy,
    className: "from-[rgb(var(--canton-rgb)/0.18)] to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[rgb(var(--canton-rgb)/0.28)] text-canton",
  };
}

function rewardKindLabel(
  kind: ReturnType<typeof campaignUiKind>,
  t: (key: string) => string,
): string {
  switch (kind) {
    case "cc_fcfs":
      return t("earnCampaigns.kindFcfs");
    case "cc_manual":
      return t("earnCampaigns.kindCc");
    case "waitlist_code":
      return t("earnCampaigns.kindInvite");
    case "waitlist_email":
      return t("earnCampaigns.kindWaitlist");
    default:
      return t("earnCampaigns.kindCampaign");
  }
}

export function QuestCard({
  quest,
  completed = false,
  variant = "default",
}: {
  quest: Quest;
  completed?: boolean;
  variant?: "default" | "earn";
}) {
  const t = usePlatformT();
  const isEarn = variant === "earn";
  const summary = quest.campaignSummary;
  const poolLower = quest.rewardPool.toLowerCase();
  const requiresFcfs =
    summary?.requiresFcfsClaim ??
    (poolLower.includes("fcfs") ||
      poolLower.includes("first come") ||
      quest.rewardType === "INVITE_CODE_FCFS");
  const uiKind = campaignUiKind(quest.rewardType, requiresFcfs);
  const kindLabel = rewardKindLabel(uiKind, t);

  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const accent = rewardAccent(quest.rewardPool, quest.rewardType);
  const RewardIcon = accent.icon;

  const ctaLabel =
    quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : t("quests.joinQuest");

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300",
        "bg-[var(--card)] ring-1 ring-[var(--border)]",
        "hover:-translate-y-1 hover:ring-[var(--primary)]/25 hover:shadow-[0_0_40px_rgb(var(--canton-rgb)/0.08)]",
        isEarn && "hover:shadow-[0_12px_48px_rgb(var(--canton-rgb)/0.12)]",
        quest.status === "ENDED" && "opacity-90",
        quest.status === "COMING_SOON" && "opacity-95",
      )}
    >
      {/* Hover glow border */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--canton-rgb) / 0.12) 0%, transparent 40%, rgb(167 139 250 / 0.08) 100%)",
        }}
      />

      {/* Hero */}
      <div
        className={cn(
          "relative shrink-0 overflow-hidden",
          isEarn ? "h-[7.5rem] sm:h-36" : "h-32",
        )}
      >
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-[var(--card)]/40 to-[var(--card)]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, rgb(var(--canton-rgb) / 0.06) 50%, transparent 100%)",
          }}
        />

        {isEarn ? (
          <span className="absolute left-3 top-3 z-[2] rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/95 backdrop-blur-md">
            {kindLabel}
          </span>
        ) : null}

        {/* Status chip */}
        <span
          className={cn(
            "absolute right-3 top-3 z-[2] rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>

        {/* Tags */}
        {quest.tags.length > 0 && (
          <div className="absolute bottom-2 left-3 right-14 z-[2] flex flex-wrap gap-1">
            {quest.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div
        className={cn(
          "relative flex flex-1 flex-col px-4 pb-4 pt-0",
          isEarn && "px-4 pb-4 sm:px-5 sm:pb-5",
        )}
      >
        {/* Logo overlap */}
        <div className={cn("-mt-6 mb-2.5 flex items-end gap-3", isEarn && "-mt-6 sm:-mt-7")}>
          <QuestLogo
            logoUrl={quest.logoUrl}
            orgSlug={quest.orgSlug}
            completed={completed}
          />
          <div className="min-w-0 flex-1 pb-0.5">
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              {quest.org}
            </p>
            <CardTitle
              className={cn(
                "line-clamp-2 text-[var(--foreground)]",
                isEarn && "text-[0.95rem] font-semibold leading-snug sm:text-base",
              )}
            >
              {quest.title}
            </CardTitle>
          </div>
        </div>

        <p
          className={cn(
            "line-clamp-2 leading-relaxed text-[var(--muted-foreground)]",
            isEarn ? "text-xs sm:text-[13px]" : "text-[13px]",
          )}
        >
          {quest.description}
        </p>

        {/* Meta chips */}
        <div className={cn("mt-2.5 flex flex-wrap gap-1.5", isEarn && "mt-3 gap-2")}>
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/50 px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[11px]">
            <ListChecks className="h-3 w-3 shrink-0 text-[var(--primary-strong)] sm:h-3.5 sm:w-3.5" />
            {quest.tasks.length} tasks
          </span>
          {quest.deadline && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/50 px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[11px]">
              <Calendar className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
              {quest.deadline}
            </span>
          )}
        </div>

        {isEarn ? (
          <EarnCampaignRewardPanel
            rewardCc={quest.rewardCc}
            rewardPool={quest.rewardPool}
            rewardType={quest.rewardType}
            summary={summary}
            labels={{
              rewardPerWinner: t("earnCampaigns.cardRewardPerWinner"),
              rewardLabel: t("earnCampaigns.rewardLabel"),
              fcfsSlots: t("earnCampaigns.cardFcfsSlots"),
              poolTotal: t("earnCampaigns.cardPoolTotal"),
              claimFlow: t("earnCampaigns.cardClaimFlow", {
                fee: String(summary?.fcfsClaimFeeCc ?? 0),
                reward: String(quest.rewardCc),
              }),
              claimFee: t("earnCampaigns.cardClaimFee"),
              codesRemaining: t("earnCampaigns.cardCodesRemaining", {
                n: String(summary?.codesRemaining ?? 0),
              }),
              invite: t("earnCampaigns.kindInvite"),
            }}
          />
        ) : (
          <div
            className={cn(
              "mt-3 flex items-center gap-2 rounded-xl border bg-gradient-to-r px-3 py-2.5",
              accent.className,
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/20">
              <RewardIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                {t("earnCampaigns.rewardLabel")}
              </p>
              <p className="truncate text-sm font-semibold">{quest.rewardPool}</p>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className={cn("pt-3.5 sm:pt-4", isEarn ? "mt-auto" : "mt-4")}>
        {canOpen ? (
          <Link
            href={ROUTES.campaignQuest(quest.id)}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition-all sm:py-3",
              quest.status === "ENDED"
                ? "border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10"
                : completed
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20"
                  : "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_24px_rgb(var(--canton-rgb)/0.25)] hover:brightness-110 hover:shadow-[0_0_32px_rgb(var(--canton-rgb)/0.35)]",
            )}
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-dashed border-[var(--border)] bg-[var(--muted)]/40 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] sm:py-3"
          >
            Opens soon
          </button>
        )}
        </div>
      </div>
    </article>
  );
}
