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
import { cn } from "@/lib/utils/utils";
import { ArrowLeft } from "lucide-react";
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
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const quest = (await res.json()) as Quest;
    return { ...quest, bannerImageUrl: resolveQuestMediaUrl(quest.bannerImageUrl), logoUrl: resolveQuestMediaUrl(quest.logoUrl) };
  } catch { return null; }
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
  if (questIdParam !== canonical) redirect(ROUTES.campaignQuest(quest.id, quest.title));
  const canonicalPath = ROUTES.campaignQuest(quest.id, quest.title);
  const statusMeta = QUEST_STATUS_BADGE[quest.status];

  return (
    <PlatformPage className="space-y-4">
      <Link href={ROUTES.campaignQuests} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Earn
      </Link>
      <header className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="relative h-32 sm:h-40">
          <div className="absolute inset-0 bg-cover bg-center" style={quest.bannerImageUrl ? { backgroundImage: `url("${quest.bannerImageUrl}")` } : { background: quest.banner }} />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/70 to-black/20" />
        </div>
        <div className="relative px-4 pb-4 -mt-8 sm:px-5 sm:pb-5 sm:-mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            {quest.logoUrl ? <img src={quest.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border-2 border-[var(--card)] object-cover sm:h-16 sm:w-16" />
            : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-[var(--card)] bg-[var(--muted)] text-base font-bold text-canton sm:h-16 sm:w-16">{quest.orgSlug.slice(0,2).toUpperCase()}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className={cn("rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", statusMeta.className)}>{statusMeta.label}</span>
                {quest.tags.map(tag => <span key={tag} className="rounded px-2 py-0.5 text-[9px] font-medium text-[var(--muted-foreground)] border border-[var(--border)]">{tag}</span>)}
              </div>
              <Eyebrow className="text-[var(--muted-foreground)]">{quest.org}</Eyebrow>
              <PageTitle className="mt-0.5 text-lg leading-tight sm:text-xl md:text-2xl text-[var(--foreground)]">{quest.title}</PageTitle>
            </div>
          </div>
        </div>
      </header>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--foreground)]">About</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)] whitespace-pre-line">{quest.description}</p>
        {quest.socialLinks?.length ? <CampaignSocialLinks links={quest.socialLinks} className="mt-3" /> : null}
      </section>
      <CampaignQuestSidebar quest={quest} />
      <section className="min-w-0">
        {isAuthed ? <QuestTaskPanel quest={quest} />
        : <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Sign in to participate</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Create an account to complete missions and claim rewards.</p>
            <div className="mt-3 flex gap-2 justify-center">
              <Link href={`/?auth=register&next=${encodeURIComponent(canonicalPath)}`} className={buttonVariants({ size: "sm" })}>Sign up</Link>
              <Link href={`/?auth=login&next=${encodeURIComponent(canonicalPath)}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Sign in</Link>
            </div>
          </div>}
      </section>
    </PlatformPage>
  );
}