import { QuestTaskPanel } from "@/components/app/quest-task-panel";
import { Eyebrow, PageTitle, SectionTitle, StatValue } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import { CQ_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { internalApiBase } from "@/lib/internal-api-url";
import {
  QUEST_STATUS_BADGE,
  type Quest,
  type RewardType,
} from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Calendar,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

type PageProps = { params: Promise<{ questId: string }> };

async function fetchQuest(questId: string): Promise<Quest | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CQ_ACCESS_COOKIE)?.value;
  const apiBase = internalApiBase();

  try {
    const res = await fetch(`${apiBase}/quests/${questId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<Quest>;
  } catch {
    return null;
  }
}

function rewardStripClass(rewardType?: RewardType, pool?: string) {
  const p = (pool ?? "").toLowerCase();
  if (rewardType === "CC_ONLY" || rewardType === "CC_AND_INVITE" || p.includes("cc")) {
    return "from-[var(--primary)]/25 to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[var(--primary)]/35";
  }
  if (rewardType?.includes("INVITE") || p.includes("invite") || p.includes("fcfs")) {
    return "from-violet-500/25 to-fuchsia-500/10 border-violet-500/35";
  }
  if (rewardType === "WAITLIST_EMAIL" || p.includes("waitlist")) {
    return "from-cyan-500/20 to-blue-500/10 border-cyan-500/30";
  }
  return "from-[rgb(var(--canton-rgb)/0.18)] to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[rgb(var(--canton-rgb)/0.28)]";
}

export default async function CampaignQuestDetailPage(props: PageProps) {
  const { questId } = await props.params;
  const quest = await fetchQuest(questId);

  if (!quest) notFound();

  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const hasTimeline = Boolean(quest.deadline || quest.endsAt);
  const rewardClass = rewardStripClass(quest.rewardType, quest.rewardPool);

  return (
    <div className="space-y-8">
      <Link
        href={ROUTES.campaignQuests}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2 text-sm font-semibold text-[var(--muted-foreground)] backdrop-blur-sm transition-all hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Earn
      </Link>

      <div className="relative overflow-hidden rounded-2xl ring-1 ring-[var(--border)]">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-[var(--card)]/70 to-[var(--card)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgb(var(--canton-rgb)/0.2)_0%,transparent_50%)]" />

        <div className="relative px-6 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
                statusMeta.className,
              )}
            >
              {statusMeta.label}
            </span>
            {quest.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quest.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/90"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end">
            {quest.logoUrl ? (
              <img
                src={quest.logoUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-2 ring-[var(--card)] shadow-lg"
              />
            ) : (
              <div className="type-section-title flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--muted)] text-canton ring-2 ring-[var(--card)]">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Eyebrow>{quest.org}</Eyebrow>
              <PageTitle className="mt-1">{quest.title}</PageTitle>
            </div>
          </div>

          <div
            className={cn(
              "mt-6 flex items-center gap-3 rounded-xl border bg-gradient-to-r px-4 py-3",
              rewardClass,
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/25">
              <Trophy className="h-5 w-5 text-canton" />
            </span>
            <div>
              <p className="type-micro-label opacity-70">Reward pool</p>
              <StatValue className="mt-1 text-lg">{quest.rewardPool}</StatValue>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <ListChecks className="h-4 w-4 text-[var(--primary-strong)]" />
            <span className="type-micro-label">Missions</span>
          </div>
          <StatValue className="mt-2 text-xl">{quest.tasks.length} tasks</StatValue>
        </div>
        {quest.rewardCc > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
              <Coins className="h-4 w-4 text-canton" />
              <span className="type-micro-label">CC reward</span>
            </div>
            <StatValue className="mt-2 text-xl text-canton">{quest.rewardCc} CC</StatValue>
          </div>
        )}
        {hasTimeline && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 p-4 backdrop-blur-sm sm:col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
              <Calendar className="h-4 w-4" />
              <span className="type-micro-label">Deadline</span>
            </div>
            <p className="mt-2 text-sm font-semibold">
              {quest.endsAt
                ? new Date(quest.endsAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : quest.deadline}
            </p>
          </div>
        )}
        {quest.rewardType?.includes("INVITE") && (
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-violet-300/80">
              <Ticket className="h-4 w-4" />
              <span className="type-micro-label">Reward type</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-violet-200">
              {quest.rewardType.replace(/_/g, " ")}
            </p>
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/60 p-6 backdrop-blur-sm md:p-8">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--primary-strong)]" />
          <SectionTitle>About this quest</SectionTitle>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] whitespace-pre-line">
          {quest.description}
        </p>
      </section>

      <section>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <Eyebrow>Verification</Eyebrow>
            <SectionTitle className="mt-1">Complete all missions</SectionTitle>
          </div>
        </div>
        <QuestTaskPanel quest={quest} />
      </section>
    </div>
  );
}
