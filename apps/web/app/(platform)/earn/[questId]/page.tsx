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
        {/* Banner — only if image exists */}
        {quest.bannerImageUrl ? (
          <div className="relative h-28 sm:h-36 md:h-40 w-full overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c14] via-[#0a0c14]/60 to-transparent" />
          </div>
        ) : (
          /* Decorative gradient strip when no banner */
          <div className="relative h-2 w-full overflow-hidden">
            <div className={cn(
              "absolute inset-0 bg-gradient-to-r opacity-60",
              config.isDual
                ? "from-[rgb(var(--canton-rgb)/0.8)] via-violet-500/60 to-transparent"
                : config.accentClass.includes("violet")
                  ? "from-violet-500/80 via-violet-400/40 to-transparent"
                  : config.accentClass.includes("cyan")
                    ? "from-cyan-500/80 via-cyan-400/40 to-transparent"
                    : "from-[rgb(var(--canton-rgb)/0.8)] via-[rgb(var(--canton-rgb)/0.4)] to-transparent"
            )} />
          </div>
        )}

        {/* Header content */}
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-start gap-4">
            {/* Logo */}
            <div className={cn(
              "relative shrink-0 overflow-hidden rounded-2xl shadow-lg ring-2 ring-white/10",
              quest.bannerImageUrl ? "-mt-10 sm:-mt-14 border-2 border-[#0a0c14]" : "",
              "h-14 w-14 sm:h-16 sm:w-16",
            )}>
              {quest.logoUrl ? (
                <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--muted)] text-base font-bold text-canton">
                  {quest.orgSlug.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* Title + badges */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(
                  "rounded-lg px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  statusMeta.className,
                )}>
                  {statusMeta.label}
                </span>
                <span className={cn(
                  "rounded-lg border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  config.chipClass,
                )}>
                  {config.shortLabel}
                </span>
                {quest.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold text-slate-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs font-semibold text-slate-400">{quest.org}</p>
              <h1 className="mt-0.5 text-xl font-bold leading-tight text-white sm:text-2xl md:text-3xl">
                {quest.title}
              </h1>
            </div>

            {/* Share button — top-right of header */}
            <ShareCampaign
              title={quest.title}
              text={shareText}
              className="shrink-0"
            />
          </div>

          {/* Description + social links — inside header */}
          {(quest.description || (quest.socialLinks && quest.socialLinks.length > 0)) && (
            <div className="mt-4 border-t border-white/[0.05] pt-4">
              {quest.description && (
                <p className="line-clamp-3 text-sm leading-relaxed text-slate-400">
                  {quest.description}
                </p>
              )}
              {quest.socialLinks && quest.socialLinks.length > 0 && (
                <CampaignSocialLinks links={quest.socialLinks} className="mt-3" />
              )}
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
