"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { CheckCircle2, Copy, Gift, Ticket, Zap } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import type { Quest, QuestTask } from "@/lib/quest/quest-types";
import { useState } from "react";

type QuestSubmitSectionProps = {
  quest: Quest & { questKind?: string };
  viewerPartyId?: string | null;
  viewerTwitterUsername?: string | null;
  onPointsEarned?: () => void;
};

export function QuestSubmitSection({ quest, viewerPartyId, viewerTwitterUsername, onPointsEarned }: QuestSubmitSectionProps) {
  const t = usePlatformT();
  const isEarnHub = quest.questKind === "EARN_HUB";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ccRewardClaimed, setCcRewardClaimed] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [showCcReward, setShowCcReward] = useState(false);
  const uiKind = quest.rewardType || "CC_ONLY";

  // Skip if no viewer
  if (!viewerPartyId) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-6 text-center text-sm text-[var(--muted-foreground)]">Connect wallet to submit tasks</div>;
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-5 space-y-4">
      {isEarnHub ? (
        <div className="text-center"><p className="text-sm font-semibold text-[var(--foreground)]">Complete tasks to earn points</p></div>
      ) : (
        <div className="text-center"><p className="text-sm font-semibold text-[var(--foreground)]">Submit your quest</p></div>
      )}

      {ccRewardClaimed ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">Reward claimed</p>
          {inviteCode && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-sm font-bold text-[var(--primary)]">{inviteCode}</p>
                <button type="button" onClick={() => navigator.clipboard.writeText(inviteCode)} className="p-1.5 rounded-md hover:bg-[var(--muted)]"><Copy className="h-4 w-4 text-[var(--muted-foreground)]" /></button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          {error && <p className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>}
          <button type="button" disabled={busy} className={cn(buttonVariants({ size: "sm" }), "gap-2 rounded-lg")} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const res = await fetch(`/api/quests/${quest.id}/claim-cc-and-code-raffle`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
              const d = await res.json().catch(() => null) as any;
              if (!res.ok) { setError(d?.message || "Failed"); return; }
              setCcRewardClaimed(true); if (d?.inviteCode) setInviteCode(d.inviteCode); onPointsEarned?.();
            } catch { setError("Network error"); } finally { setBusy(false); }
          }}>{busy ? <LoadingSpinner size="sm" /> : null} Claim Reward</button>
        </div>
      )}
    </section>
  );
}