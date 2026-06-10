"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { QuestSubmitSection } from "@/components/app/quest/quest-submit-section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { CheckCircle2, ExternalLink, Lock } from "lucide-react";
import type { Quest, QuestTask } from "@/lib/quest/quest-types";
import { useCallback, useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type Props = { quest: Quest & { questKind?: string }; viewerPartyId?: string | null; viewerTwitterUsername?: string | null; onPointsEarned?: () => void; };

export function QuestTaskPanel({ quest, viewerPartyId, viewerTwitterUsername, onPointsEarned }: Props) {
  const t = usePlatformT();
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [allDone, setAllDone] = useState(false);
  const isEarnHub = quest.questKind === "EARN_HUB";

  const verifyTask = useCallback(async (task: QuestTask) => {
    if (!viewerPartyId || !viewerTwitterUsername) return;
    setBusyTask(task.id);
    try {
      const res = await fetch(`/api/quests/${quest.id}/verify-task`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id }) });
      if (res.ok) {
        setVerified(v => ({ ...v, [task.id]: true }));
        onPointsEarned?.();
        const remaining = quest.tasks.filter(t => t.id !== task.id && !verified[t.id]);
        if (remaining.length === 0) setAllDone(true);
      }
    } catch {} finally { setBusyTask(null); }
  }, [quest, viewerPartyId, viewerTwitterUsername, verified, onPointsEarned]);

  const canVerify = Boolean(viewerPartyId && viewerTwitterUsername);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{isEarnHub ? "Daily Tasks" : "Quest Tasks"}</h3>
        <span className="text-xs text-[var(--muted-foreground)]">{quest.tasks.length} tasks</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {quest.tasks.map(task => {
          const isVerified = verified[task.id] || false;
          const isBusy = busyTask === task.id;
          return (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
              <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", isVerified ? "bg-emerald-500/15" : "bg-[var(--muted)]")}>
                {isVerified ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Lock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{task.title || task.description}</p>
                {task.description && task.title && <p className="text-xs text-[var(--muted-foreground)] truncate">{task.description}</p>}
              </div>
              {isVerified ? <span className="text-xs text-emerald-400 font-medium">Done</span>
              : <button type="button" disabled={!canVerify || isBusy} onClick={() => void verifyTask(task)} className={cn(buttonVariants({ size: "sm" }), "rounded-lg text-xs gap-1.5")}>
                {isBusy ? <LoadingSpinner size="sm" /> : <><ExternalLink className="h-3.5 w-3.5" /> Verify</>}
              </button>}
            </div>
          );
        })}
      </div>
      {allDone && <QuestSubmitSection quest={quest} viewerPartyId={viewerPartyId} viewerTwitterUsername={viewerTwitterUsername} onPointsEarned={onPointsEarned} />}
    </div>
  );
}