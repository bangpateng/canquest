import { PlatformPage } from "@/components/platform/platform-page";
import { CampaignLockGate } from "@/components/app/campaign/campaign-lock-gate";
import { CampaignSocialLinks } from "@/components/app/campaign/campaign-social-links";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { CampaignQuestSidebar } from "@/components/app/campaign/campaign-quest-sidebar";
import { ShareCampaign } from "@/components/app/earn/share-campaign";
import { ROUTES } from "@/lib/routing/app-routes";
import { CQ_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { internalApiBase } from "@/lib/api/internal-api-url";
import { resolveQuestMediaUrl } from "@/lib/quest/quest-media-url";
import { slugify } from "@/lib/routing/slug";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import { getRewardConfig } from "@/lib/quest/quest-engine";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

type PageProps = { params: Promise<{ questId: string }> };

/** Status pill — reusable badge for hero (both banner & no-banner cases). */
function StatusPill({ status, label }: { status: Quest["status"]; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
      status === "ACTIVE" && "border border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
      status === "COMING_SOON" && "border border-cyan-500/30 bg-cyan-500/20 text-cyan-300",
      status === "ENDED" && "border border-white/15 bg-black/40 text-slate-300",
    )}>
      <span className={cn(
        "relative flex h-1.5 w-1.5",
        status === "ACTIVE" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
        ),
      )}>
        <span className={cn(
          "relative inline-flex h-1.5 w-1.5 rounded-full",
          status === "ACTIVE" ? "bg-emerald-400" : status === "COMING_SOON" ? "bg-cyan-400" : "bg-slate-500",
        )} />
      </span>
      {label}
    </span>
  );
}

async function fetchQuest(questId: string): Promise<Quest | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CQ_ACCESS_COOKIE)?.value;
  const apiBase = internalApiBase();

  try {
    const url = token ? `${apiBase}/quests/${questId}` : `${apiBase}/earn/public/${questId}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const quest = (await res.json()) as Quest;
    return {
      ...quest,
      bannerImageUrl: resolveQuestMediaUrl(quest.bannerImageUrl),
      logoUrl: resolveQuestMediaUrl(quest.logoUrl),
    };
  } catch {
    return null;
  }
}

export default async function CampaignQuestDetailPage(props: PageProps) {
  const { questId: questIdParam } = await props.params;
  const questId = questIdParam.split("-")[0] ?? questIdParam;
  const cookieStore = await cookies();
  const token = cookieStore.get(CQ_ACCESS_COOKIE)?.value;
  const isAuthed = Boolean(token);
  const quest = await fetchQuest(questId);

  if (!quest) notFound();

  const canonical = `${quest.id}-${slugify(quest.title)}`;
  if (questIdParam !== canonical) {
    redirect(ROUTES.campaignQuest(quest.id, quest.title));
  }

  const canonicalPath = ROUTES.campaignQuest(quest.id, quest.title);
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const config = getRewardConfig(quest.rewardType);

  // ── Build share text based on reward type ──────────────────────
  let shareText: string;
  if (config.isDual) {
    shareText = `Earn ${quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "CC"} + 1 invite code`;
  } else if (config.code === "CC_ONLY" || config.code === "CC_MANUAL") {
    shareText = quest.rewardCc > 0 ? `Earn ${quest.rewardCc} CC` : "Earn CC rewards";
  } else if (config.code === "INVITE_CODE_FCFS") {
    shareText = "Claim an invite code — first come, first served";
  } else if (config.code === "INVITE_CODE_RANDOM") {
    shareText = "Win an invite code";
  } else if (config.code === "WAITLIST_EMAIL") {
    shareText = quest.org ? `Join the ${quest.org} waitlist` : "Join the waitlist";
  } else if (quest.rewardCc > 0) {
    shareText = `Earn ${quest.rewardCc} CC`;
  } else {
    shareText = "Check out this quest";
  }

  return (
    <PlatformPage className="space-y-5 sm:space-y-6">
      {/* Back Link */}
      <Link
        href={ROUTES.campaignQuests}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Earn
      </Link>

      {/* ── Hero Header ─────────────────────────────────────────────────── */}
      <header className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50">
        {/* Banner area — status + share float over it */}
        {quest.bannerImageUrl ? (
          <div className="relative h-32 sm:h-36 md:h-44 w-full overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c14] via-[#0a0c14]/50 to-[#0a0c14]/20" />
            {/* Status badge floats over banner — top-left */}
            <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
              <StatusPill status={quest.status} label={statusMeta.label} />
            </div>
            {/* Share floats over banner — top-right */}
            <div className="absolute right-3 top-3 sm:right-4 sm:top-4">
              <ShareCampaign title={quest.title} text={shareText} />
            </div>
          </div>
        ) : (
          /* Decorative gradient strip when no banner — with floating status/share */
          <div className="relative w-full overflow-hidden">
            <div className={cn(
              "absolute inset-0 h-12 bg-gradient-to-r opacity-60",
              config.isDual
                ? "from-[rgb(var(--canton-rgb)/0.8)] via-violet-500/60 to-transparent"
                : config.accentClass.includes("violet")
                  ? "from-violet-500/80 via-violet-400/40 to-transparent"
                  : config.accentClass.includes("cyan")
                    ? "from-cyan-500/80 via-cyan-400/40 to-transparent"
                    : "from-[rgb(var(--canton-rgb)/0.8)] via-[rgb(var(--canton-rgb)/0.4)] to-transparent"
            )} />
            <div className="relative flex h-12 items-center justify-between px-3 sm:px-4">
              <StatusPill status={quest.status} label={statusMeta.label} />
              <ShareCampaign title={quest.title} text={shareText} />
            </div>
          </div>
        )}

        {/* Header content */}
        <div className="relative px-5 pb-5 sm:px-6 sm:pb-6">
          {/* Mobile: logo overlaps up into banner; Desktop: logo inline-left */}
          {quest.bannerImageUrl ? (
            /* Logo overlapping the banner bottom — centered on mobile, left on desktop */
            <div className="-mt-10 mb-3 flex items-end gap-4 sm:-mt-14 sm:mb-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-4 border-[#0a0c14] bg-[var(--muted)] shadow-lg ring-2 ring-white/10 sm:h-20 sm:w-20">
                {quest.logoUrl ? (
                  <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-bold text-canton sm:text-2xl">
                    {quest.orgSlug.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              {/* Type + task count inline next to logo on desktop */}
              <div className="hidden pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:block">
                {quest.tasks.length} tasks
              </div>
            </div>
          ) : null}

          {/* Title block — full width, no logo competing for horizontal space on mobile */}
          <div className="min-w-0">
            {/* Mobile-only: task count (status on banner / no-banner handled separately) */}
            <div className="mb-1.5 flex items-center gap-2 sm:hidden">
              {!quest.bannerImageUrl ? <StatusPill status={quest.status} label={statusMeta.label} /> : null}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {quest.tasks.length} tasks
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-400">{quest.org}</p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight text-white sm:text-xl">
              {quest.title}
            </h1>
          </div>

          {/* Description + social links — inside header */}
          {(quest.description || (quest.socialLinks && quest.socialLinks.length > 0)) && (
            <div className="mt-4 grid gap-3 border-t border-white/[0.05] pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
              {quest.description && (
                <p className="text-sm leading-relaxed text-slate-400">
                  {quest.description}
                </p>
              )}
              {quest.socialLinks && quest.socialLinks.length > 0 ? (
                <CampaignSocialLinks links={quest.socialLinks} className="sm:justify-end" />
              ) : null}
            </div>
          )}
        </div>
      </header>

      <CampaignQuestSidebar quest={quest} />

      {/* ── Task Panel / Auth Prompt ────────────────────────────────────── */}
      <section className="min-w-0 space-y-4">
        {isAuthed && <CampaignLockGate />}
        {isAuthed ? (
          <QuestTaskPanel quest={quest} />
        ) : (
          <div className={cn(surfaceCardClass, "bg-[#0a0c14]/80 p-5 text-center")}>
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/20">
                <Sparkles className="h-7 w-7 text-[var(--primary)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Sign in to participate</h2>
                <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto">
                  You need an account to complete missions and claim rewards.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href={`/?auth=register&next=${encodeURIComponent(canonicalPath)}`}
                className={buttonVariants()}
              >
                Sign up
              </Link>
              <Link
                href={`/?auth=login&next=${encodeURIComponent(canonicalPath)}`}
                className={buttonVariants({ variant: "secondary" })}
              >
                Sign in
              </Link>
            </div>
          </div>
        )}
      </section>
    </PlatformPage>
  );
}
