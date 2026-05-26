import Link from "next/link";
import { ArrowRight, Calendar, Coins, ListChecks } from "lucide-react";
import { CampaignSocialLinks } from "@/components/app/campaign-social-links";
import { ROUTES } from "@/lib/app-routes";
import { getLandingCampaignDisplay } from "@/lib/landing-campaign-display";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest-types";
import { cn } from "@/lib/utils";

function CampaignMark({ quest }: { quest: Quest }) {
  if (quest.logoUrl) {
    return (
      <img
        src={quest.logoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <span className="text-sm font-bold text-canton">
      {quest.orgSlug.slice(0, 2).toUpperCase()}
    </span>
  );
}

function CompactCampaignCard({ quest }: { quest: Quest }) {
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";
  const { poolLabel, ccPerWinners, socialTaskCount, taskCount, questPoints } =
    getLandingCampaignDisplay(quest);

  const inner = (
    <article
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 transition-all",
        canOpen &&
          "hover:border-canton-muted hover:shadow-[0_0_32px_rgb(var(--canton-rgb)/0.1)]",
      )}
    >
      <div className="relative h-28 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/40 to-transparent" />
        <span
          className={cn(
            "absolute right-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur-md",
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>
        <div className="absolute bottom-2 left-2 flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border-2 border-[var(--card)] bg-[var(--muted)] shadow-md">
          <CampaignMark quest={quest} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="truncate text-[11px] font-medium text-[var(--muted-foreground)]">
          {quest.org}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug text-[var(--foreground)]">
          {quest.title}
        </h3>
        <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
          {quest.description}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-canton-muted bg-canton-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-canton">
            <Coins className="h-3 w-3 shrink-0" aria-hidden />
            {poolLabel}
          </span>
          {ccPerWinners ? (
            <span className="text-[11px] font-semibold tabular-nums text-canton">
              {ccPerWinners}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5 text-[var(--primary-strong)]" aria-hidden />
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
            {socialTaskCount > 0 && socialTaskCount < taskCount
              ? ` (${socialTaskCount} social)`
              : ""}
          </span>
          {questPoints > 0 ? (
            <span className="font-semibold tabular-nums text-canton">
              +{questPoints} pts
            </span>
          ) : null}
          {quest.deadline ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {quest.deadline}
            </span>
          ) : null}
        </div>

        {quest.socialLinks && quest.socialLinks.length > 0 ? (
          <CampaignSocialLinks links={quest.socialLinks} className="mt-3" />
        ) : null}

        {canOpen ? (
          <span className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-all group-hover:brightness-110">
            View campaign
            <ArrowRight className="h-4 w-4" />
          </span>
        ) : (
          <span className="mt-4 block text-center text-sm font-medium text-[var(--muted-foreground)]">
            Opens soon
          </span>
        )}
      </div>
    </article>
  );

  if (!canOpen) return inner;

  return (
    <Link
      href={ROUTES.campaignQuest(quest.id)}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {inner}
    </Link>
  );
}

export function LandingCampaignGrid({ quests }: { quests: Quest[] }) {
  const live = quests.filter(
    (q) => q.status === "ACTIVE" || q.status === "COMING_SOON",
  );

  if (live.length <= 1) return null;

  return (
    <div className="mt-10">
      <p className="mb-4 text-sm font-medium text-[var(--muted-foreground)]">
        All partner campaigns
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {live.map((quest) => (
          <CompactCampaignCard key={quest.id} quest={quest} />
        ))}
      </div>
    </div>
  );
}
