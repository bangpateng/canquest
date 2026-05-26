import {
  campaignUiKind,
  fcfsSlotsTaken,
  formatFcfsSlotsFilled,
  formatPoolTotalLabel,
  isFcfsSlotsFull,
} from "@/lib/campaign-reward";
import type { Quest } from "@/lib/quest-types";
import { QUEST_STATUS_BADGE } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import { Calendar, Coins, ListChecks, Ticket, Trophy, Users, Zap } from "lucide-react";

function formatEnd(quest: Quest): string {
  if (quest.endsAt) {
    return new Date(quest.endsAt).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return quest.deadline ?? "—";
}

export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const summary = quest.campaignSummary;
  const uiKind = campaignUiKind(quest.rewardType, quest.rewardPool);
  const poolLabel = formatPoolTotalLabel(summary?.poolTotalCc ?? null, quest.rewardPool);
  const slotsTaken = fcfsSlotsTaken(summary?.remainingSlots, summary?.maxWinners);
  const slotsMax = summary?.maxWinners ?? 0;
  const slotsFull = isFcfsSlotsFull(summary?.remainingSlots, summary?.maxWinners);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] bg-gradient-to-br from-[var(--primary)]/10 via-transparent to-transparent px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Campaign reward
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--foreground)]">{poolLabel}</p>
          {quest.rewardCc > 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-canton">
              <Coins className="h-4 w-4" aria-hidden />
              {quest.rewardCc} CC per winner
            </p>
          ) : null}
        </div>

        <dl className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <dt className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              Tasks
            </dt>
            <dd className="text-sm font-bold tabular-nums">{quest.tasks.length}</dd>
          </div>

          {summary?.requiresFcfsClaim && slotsMax > 0 ? (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <dt className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Users className="h-3.5 w-3.5" aria-hidden />
                FCFS slots
              </dt>
              <dd
                className={cn(
                  "text-sm font-bold tabular-nums",
                  slotsFull ? "text-[var(--muted-foreground)]" : "text-canton",
                )}
              >
                {formatFcfsSlotsFilled(slotsTaken, slotsMax)}
              </dd>
            </div>
          ) : null}

          {summary?.requiresFcfsClaim && (summary.fcfsClaimFeeCc ?? 0) > 0 ? (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <dt className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Claim fee
              </dt>
              <dd className="text-sm font-bold tabular-nums">{summary.fcfsClaimFeeCc} CC</dd>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <dt className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              Ends
            </dt>
            <dd className="text-right text-xs font-semibold leading-snug">{formatEnd(quest)}</dd>
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <dt className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              Type
            </dt>
            <dd className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">
              {uiKind === "cc_fcfs" ? "FCFS" : uiKind.replace(/_/g, " ")}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">Status</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              statusMeta.className,
            )}
          >
            {statusMeta.label}
          </span>
        </div>
        {quest.rewardType?.includes("INVITE") ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-violet-300/90">
            <Ticket className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Invite code reward
          </p>
        ) : null}
      </div>
    </div>
  );
}
