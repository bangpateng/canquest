import { QUEST_BANNER_TAG_PILL, type Quest } from "@/lib/quest-types";
import { Calendar, CheckCircle2, Trophy } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

function QuestLogo({ logoUrl, orgSlug }: { logoUrl?: string | null; orgSlug: string }) {
  if (logoUrl) {
    return (
      <img /* eslint-disable-line @next/next/no-img-element */
        src={logoUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-xl border border-[var(--border)] object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--muted)] font-[family-name:var(--font-space)] text-sm font-bold">
      {orgSlug.slice(0, 2)}
    </div>
  );
}

/** Shared finish CTA (below banner on cards) — softer than banner pills */
const QUEST_COMPLETE_STYLES =
  "border border-emerald-700/40 bg-emerald-600/15 text-emerald-900 dark:border-emerald-400/45 dark:bg-emerald-500/20 dark:text-emerald-100";

export function QuestCard({
  quest,
  completed = false,
}: {
  quest: Quest;
  completed?: boolean;
}) {
  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-shadow hover:shadow-md",
        quest.status === "ENDED" && "opacity-[0.92]",
        quest.status === "COMING_SOON" && "opacity-95",
      )}
    >
      <div
        className="relative h-28 w-full shrink-0 bg-cover bg-center"
        style={
          quest.bannerImageUrl
            ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
            : { background: quest.banner }
        }
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)]/80 to-transparent" />
        {quest.tags.length > 0 && (
          <div className="absolute bottom-2 left-3 right-3 z-[1] flex flex-wrap gap-1.5">
            {quest.tags.map((t) => (
              <span
                key={t}
                className={cn(QUEST_BANNER_TAG_PILL, "rounded-md uppercase tracking-wide")}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <QuestLogo logoUrl={quest.logoUrl} orgSlug={quest.orgSlug} />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {quest.org}
            </p>
            <h3 className="font-[family-name:var(--font-space)] text-base font-semibold leading-snug">
              {quest.title}
            </h3>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-[var(--muted-foreground)]">
          {quest.description}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {quest.tasks.length} tasks
          </span>
          {quest.deadline && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {quest.deadline}
            </span>
          )}
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
          <Trophy className="h-3.5 w-3.5 text-amber-500" />
          {quest.rewardPool}
        </p>
        {canOpen ? (
          <Link
            href={`/quests/${quest.id}`}
            className={cn(
              "mt-4 flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90",
              quest.status === "ENDED"
                ? "border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)]/40"
                : completed
                  ? QUEST_COMPLETE_STYLES
                  : "bg-[var(--primary)] text-[var(--primary-foreground)]",
            )}
          >
            {quest.status === "ENDED"
              ? "View recap"
              : completed
                ? "View Quest Complete"
                : "Start quest"}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/50 py-2.5 text-sm font-semibold text-[var(--muted-foreground)]"
          >
            Opens soon
          </button>
        )}
      </div>
    </article>
  );
}
