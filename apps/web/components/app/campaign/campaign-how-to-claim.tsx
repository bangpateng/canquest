"use client";

import { useEffect, useState } from "react";
import { Clock, Coins, Ticket, Zap } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import type { Quest } from "@/lib/quest/quest-types";

function Countdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  const diff = end - now;
  if (diff <= 0) return <span className="text-red-400 font-bold text-sm">Ended</span>;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const parts = days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-300">
      <Clock className="h-4 w-4" aria-hidden />
      {parts}
    </span>
  );
}

function flowSteps(rewardType: string | undefined): { steps: string[]; icon: React.ElementType } {
  if (!rewardType) return { steps: ["Complete tasks", "Submit quest", "Receive reward"], icon: Zap };
  switch (rewardType) {
    case "CC_ONLY":
      return { steps: ["Complete tasks", "Pay claim fee", "Claim  CC"], icon: Coins };
    case "CC_MANUAL":
      return { steps: ["Complete tasks", "Submit quest", "Admin draws winners", "Winners claim CC"], icon: Coins };
    case "INVITE_CODE_FCFS":
      return { steps: ["Complete tasks", "Pay claim fee", "Reveal code"], icon: Ticket };
    case "INVITE_CODE_RANDOM":
    case "INVITE_CODE":
      return { steps: ["Complete tasks", "Submit quest", "Admin draws winners", "Winners reveal code"], icon: Ticket };
    case "CC_AND_CODE_RAFFLE":
      return { steps: ["Complete tasks", "Submit quest", "Admin draws winners", "Winners get CC + Code"], icon: Zap };
    case "WAITLIST_EMAIL":
      return { steps: ["Complete tasks", "Submit email", "Admin selects winners"], icon: Ticket };
    default:
      return { steps: ["Complete tasks", "Submit quest", "Receive reward"], icon: Zap };
  }
}

export function CampaignHowToClaim({ quest }: { quest: Quest }) {
  const { steps, icon: Icon } = flowSteps(quest.rewardType);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/60 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--primary)]" aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            How to Claim
          </h2>
        </div>
        {quest.endsAt ? (
          <Countdown endsAt={quest.endsAt} />
        ) : quest.deadline ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <Clock className="h-4 w-4" aria-hidden />
            {quest.deadline}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
        {steps.map((step, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                i === 0
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]",
              )}
            >
              {i + 1}⃝ {step}
            </span>
            {i < steps.length - 1 && (
              <span className="text-slate-600 mx-0.5">→</span>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}