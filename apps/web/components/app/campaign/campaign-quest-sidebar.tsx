import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { isCcTokenRewardQuest } from "@/lib/canton/cc-reward-logo";
import { formatCodePerWinners } from "@/lib/canton/campaign-reward";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import {
  Calendar,
  Clock,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
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

type Tile = {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string | null;
  tone?: "default" | "canton" | "violet" | "amber" | "muted";
  progress?: { used: number; max: number; warn?: boolean } | null;
};

const TONE_TEXT: Record<NonNullable<Tile["tone"]>, string> = {
  default: "text-white",
  canton: "text-canton",
  violet: "text-violet-300",
  amber: "text-amber-300",
  muted: "text-slate-400",
};

/** Map metric iconKind from quest-engine to LucideIcon. */
function resolveIcon(kind: string): LucideIcon {
  switch (kind) {
    case "cc": return Coins;
    case "zap": return Zap;
    case "users": return Users;
    case "ticket": return Ticket;
    case "sparkles": return Sparkles;
    default: return Trophy;
  }
}

/** Map metric accent class to sidebar tile tone. */
function resolveTone(accent?: string, muted?: boolean): Tile["tone"] {
  if (muted) return "muted";
  if (!accent) return "default";
  if (accent.includes("violet")) return "violet";
  if (accent.includes("amber")) return "amber";
  if (accent.includes("canton")) return "canton";
  return "default";
}

/**
 * Campaign reward + meta — type-aware highlight panel shown above quest tasks.
 * Uses getQuestMeta from quest-engine for all derived state.
 */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const meta = getQuestMeta(quest);
  const { config, rewardDisplay, slots, metrics } = meta;
  const summary = quest.campaignSummary;

  // ── Build tiles from quest-engine metrics ──────────────────────
  const tiles: Tile[] = [];

  // Per-winner reward tile (always first when applicable)
  if (quest.rewardCc > 0) {
    tiles.push({
      key: "perWinner",
      icon: Trophy,
      label: "Reward / winner",
      value: `${quest.rewardCc} CC`,
      tone: "canton",
    });
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    tiles.push({
      key: "perWinner",
      icon: Ticket,
      label: "Reward / winner",
      value: "1 Code",
      tone: "violet",
    });
  }

  // Participation metric from quest-engine (FCFS slots or raffle winners)
  for (const m of metrics) {
    if (m.key === "fcfs") {
      tiles.push({
        key: "fcfs",
        icon: Zap,
        label: m.label,
        value: m.value,
        hint: slots.full ? "All slots claimed" : `${slots.left} left`,
        tone: resolveTone(m.accent, m.muted),
        progress: slots.full ? null : { used: slots.used, max: slots.max, warn: slots.warn },
      });
    } else if (m.key === "winners") {
      tiles.push({
        key: "winners",
        icon: Users,
        label: m.label,
        value: m.value,
        hint: slots.used > 0 ? "selected" : "drawn at the end",
        tone: "canton",
        progress: slots.used > 0 ? { used: slots.used, max: slots.max } : null,
      });
    }
  }

  // Claim fee tile
  if (
    (slots.isFcfs || slots.isRaffle || config.isDual) &&
    (summary?.fcfsClaimFeeCc ?? 0) > 0
  ) {
    tiles.push({
      key: "fee",
      icon: Zap,
      label: "Claim fee",
      value: `${summary?.fcfsClaimFeeCc ?? 0} CC`,
      hint: "paid on-chain to claim",
      tone: "amber",
    });
  }

  // Codes remaining tile
  const codesMetric = metrics.find((m) => m.key === "codes");
  if (codesMetric) {
    tiles.push({
      key: "codes",
      icon: Ticket,
      label: "Codes left",
      value: codesMetric.value.replace(/ invite codes left$/, ""),
      tone: "violet",
    });
  }

  // ── Compact meta row (always shown) ───────────────────────────
  const metaRow: { key: string; icon: LucideIcon; label: string; value: string }[] = [
    { key: "tasks", icon: ListChecks, label: "Tasks", value: String(quest.tasks.length) },
    {
      key: "ends",
      icon: quest.endsAt ? Clock : Calendar,
      label: "Ends",
      value: formatEnd(quest),
    },
    { key: "type", icon: Trophy, label: "Type", value: config.shortLabel },
  ];

  return (
    <section
      className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/40"
      aria-label="Campaign reward"
    >
      {/* ── Reward headline ─────────────────────────────────────────────── */}
      <div className="relative border-b border-white/[0.06] px-5 py-6 sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_90%_at_0%_0%,rgb(var(--canton-rgb)/0.12),transparent_60%)]" />
        <div className="relative min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--canton-rgb)/0.25)] bg-[rgb(var(--canton-rgb)/0.08)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-canton sm:text-xs">
              <Trophy className="h-3 w-3" aria-hidden />
              {config.shortLabel}
            </span>
            {slots.full && slots.isFcfs ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">
                Slots full
              </span>
            ) : null}
          </div>

          {config.isDual ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <CcRewardLogo className="sm:h-8 sm:w-8" size={28} />
                  <span className="text-2xl font-bold text-white sm:text-3xl">
                    {quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "CC"}
                  </span>
                </div>
                <span className="text-xl font-bold text-slate-500">+</span>
                <div className="flex items-center gap-2">
                  <Ticket className="h-6 w-6 text-violet-300 sm:h-8 sm:w-8" aria-hidden />
                  <span className="text-2xl font-bold text-violet-300 sm:text-3xl">1 Code</span>
                </div>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-400">Per winner</p>
            </div>
          ) : (
            <>
              <p className="mt-3 flex items-center gap-3 text-3xl font-bold tabular-nums text-white sm:text-4xl">
                {isCcTokenRewardQuest(quest) ? (
                  <CcRewardLogo className="sm:h-8 sm:w-8" size={32} />
                ) : null}
                <span>
                  {config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM"
                    ? formatCodePerWinners()
                    : rewardDisplay.primaryText}
                </span>
              </p>
              {rewardDisplay.secondaryText ? (
                <p className="mt-2 text-sm font-medium text-slate-400">
                  {rewardDisplay.secondaryText}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── Highlight tiles (type-aware) ─────────────────────────────────── */}
      {tiles.length > 0 ? (
        <div
          className={cn(
            "grid gap-px bg-white/[0.04]",
            tiles.length === 1 && "grid-cols-1",
            tiles.length === 2 && "grid-cols-2",
            tiles.length >= 3 && "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {tiles.map(({ key, icon: Icon, label, value, hint, tone = "default", progress }) => (
            <div key={key} className="flex min-w-0 flex-col gap-2 bg-[#0a0c14]/90 px-4 py-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">
                <Icon className="h-3.5 w-3.5 shrink-0 text-canton opacity-90" aria-hidden />
                <span className="truncate">{label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-lg font-bold tabular-nums sm:text-xl", TONE_TEXT[tone])}>
                  {value}
                </span>
                {hint ? (
                  <span className="truncate text-[10px] font-medium text-slate-500">{hint}</span>
                ) : null}
              </div>
              {progress ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      progress.warn
                        ? "bg-gradient-to-r from-amber-500 to-orange-500"
                        : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
                    )}
                    style={{
                      width: `${Math.max(6, Math.min(100, Math.round((progress.used / Math.max(1, progress.max)) * 100)))}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Compact meta row ─────────────────────────────────────────────── */}
      <dl className="grid grid-cols-3 gap-px border-t border-white/[0.04] bg-white/[0.04]">
        {metaRow.map(({ key, icon: Icon, label, value }) => (
          <div key={key} className="flex min-w-0 flex-col gap-1 bg-[#0a0c14]/90 px-4 py-3">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{label}</span>
            </dt>
            <dd
              className={cn(
                "truncate font-bold text-slate-100",
                key === "ends" ? "text-xs leading-snug" : "text-sm",
                key === "type" && "uppercase tracking-wide text-[11px] text-canton",
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
