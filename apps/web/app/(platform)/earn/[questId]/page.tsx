import { PlatformPage } from "@/components/platform/platform-page";
import { CampaignSocialLinks } from "@/components/app/campaign/campaign-social-links";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { CampaignQuestSidebar } from "@/components/app/campaign/campaign-quest-sidebar";
import { Eyebrow, PageTitle } from "@/components/ui/typography";
import { ROUTES } from "@/lib/routing/app-routes";
import { CQ_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { internalApiBase } from "@/lib/api/internal-api-url";
import { resolveQuestMediaUrl } from "@/lib/quest/quest-media-url";
import { slugify } from "@/lib/routing/slug";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
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

  return (
    <PlatformPage className="space-y-5 sm:space-y-6">
      <Link
        href={ROUTES.campaignQuests}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Earn
      </Link>

      <header className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="relative h-32 sm:h-40 md:h-44">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={
              quest.bannerImageUrl
                ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
                : { background: quest.banner }
            }
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/80 to-black/15" />
        </div>

        <div className="relative px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
          <div className="-mt-9 flex flex-col gap-3 sm:-mt-11 sm:flex-row sm:items-end sm:gap-4">
            {quest.logoUrl ? (
              <img
                src={quest.logoUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-xl border-[3px] border-[var(--card)] object-cover shadow-md sm:h-20 sm:w-20 sm:rounded-2xl sm:border-4"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-[3px] border-[var(--card)] bg-[var(--muted)] text-lg font-bold text-canton shadow-md sm:h-20 sm:w-20 sm:rounded-2xl sm:border-4">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    statusMeta.className,
                  )}
                >
                  {statusMeta.label}
                </span>
                {quest.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <Eyebrow className="text-[var(--muted-foreground)]">{quest.org}</Eyebrow>
              <PageTitle className="mt-0.5 text-xl leading-tight sm:text-2xl md:text-3xl">
                {quest.title}
              </PageTitle>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/60 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--primary-strong)]" aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            About
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] whitespace-pre-line">
          {quest.description}
        </p>
        {quest.socialLinks && quest.socialLinks.length > 0 ? (
          <CampaignSocialLinks links={quest.socialLinks} className="mt-4 pt-1" />
        ) : null}
      </section>

      <CampaignQuestSidebar quest={quest} />

      <section className="min-w-0">
        {isAuthed ? (
          <QuestTaskPanel quest={quest} />
        ) : (
          <div className={cn(surfaceCardClass, "bg-[var(--card)]/60 p-5 text-center")}>
            <h2 className="type-section-title">Sign in to participate</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              You need an account to complete missions and claim rewards.
            </p>
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
