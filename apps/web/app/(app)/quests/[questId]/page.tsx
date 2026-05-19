import { QuestTaskPanel } from "@/components/app/quest-task-panel";
import { CQ_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { internalApiBase } from "@/lib/internal-api-url";
import { QUEST_BANNER_TAG_PILL, type Quest } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import { Calendar, ChevronLeft, Trophy } from "lucide-react";
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
    });
    if (!res.ok) return null;
    return res.json() as Promise<Quest>;
  } catch {
    return null;
  }
}

export default async function QuestDetailPage(props: PageProps) {
  const { questId } = await props.params;
  const quest = await fetchQuest(questId);

  if (!quest) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/quests"
        className="inline-flex min-h-10 items-center gap-2 rounded-xl px-1 text-[15px] font-semibold text-[var(--foreground)] underline-offset-4 transition-colors hover:underline hover:opacity-90"
      >
        <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
        Back to quests
      </Link>

      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm",
          quest.bannerImageUrl && "bg-cover bg-center",
        )}
        style={
          quest.bannerImageUrl
            ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
            : { background: quest.banner }
        }
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/85 to-transparent" />
        <div className="relative flex flex-col gap-4 px-6 pb-6 pt-8 md:flex-row md:items-end md:justify-between md:pb-10 md:pt-14">
          <div className="flex gap-4">
            {quest.logoUrl ? (
              <img
                src={quest.logoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--muted)] object-cover backdrop-blur-sm"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--muted)] font-[family-name:var(--font-space)] text-lg font-bold text-[var(--foreground)] backdrop-blur-sm">
                {quest.orgSlug.slice(0, 2)}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {quest.org}
              </p>
              <h2 className="max-w-xl font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight text-[var(--foreground)] md:text-3xl">
                {quest.title}
              </h2>
            </div>
          </div>
          {quest.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
              {quest.tags.map((t) => (
                <span key={t} className={QUEST_BANNER_TAG_PILL}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Reward pool</p>
          <p className="mt-1 inline-flex items-center gap-1.5 font-semibold">
            <Trophy className="h-4 w-4 text-amber-500" />
            {quest.rewardPool}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Tasks</p>
          <p className="mt-1 font-semibold">{quest.tasks.length} tasks to complete</p>
        </div>
        {quest.deadline && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">Ends</p>
            <p className="mt-1 flex items-center gap-2 font-semibold">
              <Calendar className="h-4 w-4 text-[var(--muted-foreground)]" />
              {quest.deadline}
            </p>
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-8">
        <h3 className="font-[family-name:var(--font-space)] text-lg font-semibold">
          About this quest
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted-foreground)]">
          {quest.description}
        </p>
      </section>

      <section>
        <div className="mb-5">
          <h3 className="font-[family-name:var(--font-space)] text-lg font-semibold">
            Tasks & verification
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Complete each task below. Verified tasks are recorded on the Canton
            ledger as Proof of Execution.
          </p>
        </div>
        <QuestTaskPanel quest={quest} />
      </section>
    </div>
  );
}
