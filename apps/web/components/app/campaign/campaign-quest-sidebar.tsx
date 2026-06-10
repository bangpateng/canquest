import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import {
  campaignTypeDisplayValue,
  campaignUiKind,
  formatCodePerWinners,
  formatFcfsSlotsFilled,
  getCampaignRewardHeadline,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";
import { isCcTokenRewardQuest } from "@/lib/canton/cc-reward-logo";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { Calendar, ListChecks, Ticket, Trophy, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

type StatItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  valueClassName?: string;
};

/** Campaign reward + meta — shown above quest tasks (mobile-first, full width). */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const summary = quest.campaignSummary;
  const requiresFcfs = summary?.requiresFcfsClaim ?? false;
  const requiresPaidInvite = summary?.requiresPaidInviteClaim ?? false;
  const requiresDrawCc = summary?.requiresDrawCcClaim ?? false;
  const isCcAndCodeRaffle = quest.rewardType === "CC_AND_CODE_RAFFLE";
  const uiKind = campaignUiKind(quest.rewardType, requiresFcfs);
  const rewardHeadline = getCampaignRewardHeadline(
    quest,
    summary?.poolTotalCc ?? null,
  );
  const slotsMax = summary?.maxWinners ?? 0;
  const slotsFull = isFcfsSlotsFull(summary?.remainingSlots, summary?.maxWinners);
  const showFcfsSlots = (requiresFcfs || requiresPaidInvite) && slotsMax > 0;

  const stats: StatItem[] = [
    {
      key: "tasks",
      icon: ListChecks,
      label: "Tasks",
      value: String(quest.tasks.length),
    },
  ];

  if (showFcfsSlots) {
    stats.push({
      key: "slots",
      icon: Users,
      label: "FCFS slots",
      value: formatFcfsSlotsFilled(summary?.remainingSlots, slotsMax),
      valueClassName: slotsFull ? "text-[var(--muted-foreground)]" : "text-canton",
    });
  }

  if (requiresDrawCc && slotsMax > 0) {
    stats.push({
      key: "winners",
      icon: Users,
      label: "Winners",
      value: `${slotsMax} max`,
      valueClassName: "text-canton",
    });
  }

  // CC + Code Raffle: show winners count
  if (isCcAndCodeRaffle && slotsMax > 0) {
    stats.push({
      key: "winners",
      icon: Users,
      label: "Winners",
      value: `${slotsMax} max`,
      valueClassName: "text-canton",
    });
  }

  if ((showFcfsSlots || requiresDrawCc || isCcAndCodeRaffle) && (summary?.fcfsClaimFeeCc ?? 0) > 0) {
    stats.push({
      key: "fee",
      icon: Zap,
      label: "Claim fee",
      value: `${summary?.fcfsClaimFeeCc ?? 0} CC`,
    });
  }

  stats.push({
    key: "ends",
    icon: Calendar,
    label: "Ends",
    value: formatEnd(quest),
    valueClassName: "text-xs leading-snug",
  });

  stats.push({
    key: "type",
    icon: Trophy,
    label: "Type",
    value: campaignTypeDisplayValue(uiKind, quest.rewardType),
    valueClassName: "uppercase tracking-wide text-[11px]",
  });

  return (
    <section
      className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm"
      aria-label="Campaign reward"
    >
      <div className="border-b border-slate-800/80 bg-gradient-to-br from-[var(--primary)]/12 via-transparent to-transparent px-6 py-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Campaign reward
          </p>
          {isCcAndCodeRaffle ? (
            /* CC + Code Raffle: show dual reward with both logos */
            <div className="mt-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <CcRewardLogo className="sm:h-8 sm:w-8" size={28} />
                  <span className="text-2xl font-bold text-white sm:text-3xl">
                    {quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "CC"}
                  </span>
                </div>
                <span className="text-xl font-bold text-slate-400">+</span>
                <div className="flex items-center gap-2">
                  <Ticket className="h-6 w-6 text-violet-300 sm:h-8 sm:w-8" aria-hidden />
                  <span className="text-2xl font-bold text-violet-300 sm:text-3xl">
                    1 Code
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-400">
                Per Winner
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-3 text-3xl font-bold tabular-nums text-white sm:text-4xl">
                {isCcTokenRewardQuest(quest) ? (
                  <CcRewardLogo className="sm:h-8 sm:w-8" size={32} />
                ) : null}
                <span>
                  {quest.rewardType?.includes("INVITE")
                    ? formatCodePerWinners()
                    : rewardHeadline.primary}
                </span>
              </p>
              {rewardHeadline.secondary ? (
                <p className="mt-2 text-sm font-medium text-slate-400">
                  {rewardHeadline.secondary}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-800/80 border-slate-800/80 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(({ key, icon: Icon, label, value, valueClassName }) => (
          <div
            key={key}
            className="flex min-w-0 flex-col justify-center gap-2 bg-[var(--card)]/80 px-4 py-4"
          >
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <span className="truncate">{label}</span>
            </dt>
            <dd
              className={cn(
                "text-base font-bold tabular-nums text-slate-100",
                valueClassName,
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </div>
    </section>
  );
}
