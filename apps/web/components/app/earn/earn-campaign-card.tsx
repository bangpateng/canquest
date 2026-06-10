"use client";
import Link from "next/link";
import { campaignUiKind, fcfsSlotsTaken, formatFcfsSlotsFilled, formatPoolTotalLabel, hasParticipatedInQuest, isFcfsSlotsFull } from "@/lib/canton/campaign-reward";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import { Clock, Coins, Ticket } from "lucide-react";

function rewardTheme(pool: string, rt?: string) {
  if (rt === "CC_AND_CODE_RAFFLE") return { isCc: true, isDual: true, accent: "text-canton", chip: "bg-gradient-to-r from-canton-soft to-violet-500/15 text-canton border-canton-muted" };
  if (rt === "CC_ONLY" || rt === "CC_MANUAL" || rt === "CC_AND_INVITE" || pool.toLowerCase().includes("cc")) return { isCc: true, isDual: false, accent: "text-canton", chip: "bg-canton-soft text-canton border-canton-muted" };
  if (rt?.includes("INVITE") || pool.toLowerCase().includes("invite") || pool.toLowerCase().includes("fcfs")) return { isCc: false, isDual: false, accent: "text-violet-300", chip: "bg-violet-500/15 text-violet-200 border-violet-500/25" };
  if (rt === "WAITLIST_EMAIL" || pool.toLowerCase().includes("waitlist")) return { isCc: false, isDual: false, accent: "text-cyan-300", chip: "bg-cyan-500/12 text-cyan-200 border-cyan-500/25" };
  return { isCc: false, isDual: false, accent: "text-canton", chip: "bg-canton-soft text-canton border-canton-muted" };
}

function kindLabel(k: ReturnType<typeof campaignUiKind>, rt: string | undefined, t: (key: string) => string): string {
  switch (k) { case "cc_fcfs": return t("earnCampaigns.kindFcfs"); case "cc_manual_draw": return t("earnCampaigns.kindCcRaffle"); case "cc_manual": return t("earnCampaigns.kindCc"); case "cc_and_code_raffle": return "CC + Code Raffle"; case "waitlist_code": return rt === "INVITE_CODE_FCFS" ? t("earnCampaigns.kindInvite") : t("earnCampaigns.kindRaffle"); case "waitlist_email": return t("earnCampaigns.kindWaitlist"); default: return t("earnCampaigns.kindCampaign"); }
}
function CountdownTimer({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(i); }, []);
  if (!endsAt) return null; const e = new Date(endsAt).getTime(), d = e - now; if (d <= 0) return <span className="text-red-400 font-bold text-[10px]">Ended</span>;
  const days = Math.floor(d / 86400000), hours = Math.floor((d % 86400000) / 3600000), mins = Math.floor((d % 3600000) / 60000);
  const p: string[] = []; if (days > 0) p.push(`${days}d`); if (hours > 0 || days > 0) p.push(`${hours}h`); p.push(`${mins}m`);
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300"><Clock className="h-3 w-3" />{p.join(" ")}</span>;
}

export function EarnCampaignCard({ quest, completed = false, userProgress = null }: { quest: Quest; completed?: boolean; userProgress?: UserProgress | null; }) {
  const t = usePlatformT(); const s = quest.campaignSummary; const pl = quest.rewardPool.toLowerCase();
  const isCcCode = quest.rewardType === "CC_AND_CODE_RAFFLE";
  const isDrawCc = quest.rewardType === "CC_MANUAL" || Boolean(s?.requiresDrawCcClaim);
  const isCode = quest.rewardType === "INVITE_CODE_FCFS" || quest.rewardType === "INVITE_CODE_RANDOM" || quest.rewardType === "INVITE_CODE" || quest.rewardType === "CC_AND_INVITE";
  const isCf = quest.rewardType === "INVITE_CODE_FCFS";
  const reqFcfs = isDrawCc ? false : isCf ? true : s?.requiresFcfsClaim ?? (pl.includes("fcfs") || pl.includes("first come") || quest.rewardType === "INVITE_CODE_FCFS");
  const uiKind = campaignUiKind(quest.rewardType, reqFcfs); const theme = rewardTheme(quest.rewardPool, quest.rewardType);
  const hp = hasParticipatedInQuest(quest, userProgress); const sm = s?.maxWinners ?? 0;
  const sl = s?.remainingSlots ?? 0; const wd = s?.slotsTaken ?? 0; const su = fcfsSlotsTaken(sl, sm);
  const sf = reqFcfs && isFcfsSlotsFull(sl, sm); const jb = sf && !hp && quest.status === "ACTIVE";
  const can = quest.status === "ACTIVE" || quest.status === "ENDED" || (sf && hp);
  const smeta = QUEST_STATUS_BADGE[quest.status];
  const showFcfs = reqFcfs && s != null && sm > 0 && s.remainingSlots != null;
  const showRw = !isCf && (isDrawCc || (!isDrawCc && isCode && !reqFcfs && sm > 0) || (quest.rewardType === "WAITLIST_EMAIL" && sm > 0)) && sm > 0;
  const rl = quest.rewardType === "WAITLIST_EMAIL" || (!isDrawCc && isCode && !reqFcfs) ? String(sm) : wd > 0 ? t("earnCampaigns.slotsSelected", { used: String(wd), max: String(sm) }) : String(sm);
  const rp = sm > 0 ? Math.round((wd / sm) * 100) : 0;
  const plabel = formatPoolTotalLabel(s?.poolTotalCc ?? null, quest.rewardPool);
  const pd = isCode && /^\d+(\.\d+)?$/.test(plabel.trim()) ? `${plabel.trim()} ${t("earnCampaigns.codeLabel")}` : plabel;
  const sp = plabel !== "\u2014" || (s?.poolTotalCc ?? 0) > 0;
  const spa = sm > 0 ? Math.round((su / sm) * 100) : 0;
  const cta = jb ? t("earnCampaigns.slotsEnded") : quest.status === "ENDED" ? "View" : completed ? t("quests.questComplete") : hp && sf ? t("earnCampaigns.viewMyQuest") : t("quests.joinQuest");
  const stl = sf && quest.status === "ACTIVE" ? t("earnCampaigns.slotsEnded") : smeta.label;

  const inner = (
    <article className={cn("group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] transition-shadow hover:border-[var(--primary)]/20", (quest.status === "ENDED" || jb) && "opacity-80")}>
      <div className="relative h-32 shrink-0 overflow-hidden sm:h-36">
        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105" style={quest.bannerImageUrl ? { backgroundImage: `url("${quest.bannerImageUrl}")` } : { background: quest.banner }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/60 to-black/20" />
        <div className="absolute left-2 top-2"><span className={cn("rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", theme.chip)}>{kindLabel(uiKind, quest.rewardType, t)}</span></div>
        <span className={cn("absolute right-2 top-2 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-white/10 bg-black/50 text-white", sf && quest.status === "ACTIVE" ? "text-slate-400" : smeta.className)}>{stl}</span>
        {(isCcCode || quest.rewardCc > 0 || (!isCcCode && !quest.rewardCc && isCode)) && (
          <div className="absolute bottom-2 right-2 rounded border border-white/10 bg-black/60 px-2.5 py-1.5 backdrop-blur">
            <p className="text-xs font-bold tabular-nums text-canton">
              {isCcCode && quest.rewardCc > 0 ? <>{quest.rewardCc} <span className="text-[10px] text-white/60">CC</span> <span className="text-white/30">+</span> </> : null}
              {quest.rewardCc > 0 && !isCcCode ? <>{quest.rewardCc} <span className="text-[10px] text-white/60">CC</span></> : null}
              {isCcCode || (isCode && quest.rewardCc <= 0) ? <span className={isCcCode ? "text-violet-300" : "text-violet-200"}>1 Code</span> : null}
              {!isCcCode && !isCode && quest.rewardCc <= 0 && <span className="text-xs text-white/80 truncate">{quest.rewardPool}</span>}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-[var(--muted)]">{quest.logoUrl ? <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-canton">{quest.orgSlug.slice(0,2).toUpperCase()}</span>}</div>
          <div className="min-w-0"><p className="truncate text-[10px] text-[var(--muted-foreground)]">{quest.org}</p><h3 className="line-clamp-2 text-sm font-bold text-[var(--foreground)]">{quest.title}</h3></div>
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-[var(--muted-foreground)]">{quest.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted-foreground)]">
          <span>{quest.tasks.length} tasks</span>
          {quest.endsAt ? <CountdownTimer endsAt={quest.endsAt} /> : quest.deadline ? <span>{quest.deadline}</span> : null}
        </div>
        {(showFcfs || showRw || sp) && (
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/50 divide-y divide-[var(--border)]">
            <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
              {showRw && <div className="px-2.5 py-2"><p className="text-[9px] uppercase text-[var(--muted-foreground)]">Winners</p><p className="text-xs font-bold text-[var(--foreground)]">{rl}</p></div>}
              {showFcfs && <div className="px-2.5 py-2"><p className="text-[9px] uppercase text-[var(--muted-foreground)]">Slots</p><p className={cn("text-xs font-bold", sf ? "text-[var(--muted-foreground)]" : "text-canton")}>{formatFcfsSlotsFilled(sl, s!.maxWinners, t("earnCampaigns.slotsEnded"))}</p></div>}
              {sp && <div className="px-2.5 py-2"><p className="text-[9px] uppercase text-[var(--muted-foreground)]">Pool</p><p className="text-xs font-bold text-canton">{pd}</p></div>}
            </div>
          </div>
        )}
        <div className="mt-3">
          {jb ? <span className={cn(buttonVariants({ variant: "muted", size: "block" }), "flex h-10 w-full items-center justify-center rounded-md text-xs font-semibold")}>{cta}</span>
          : can ? <span className={cn(buttonVariants({ variant: quest.status === "ENDED" ? "secondary" : completed ? "success" : "primary", size: "block" }), "flex h-10 w-full items-center justify-center rounded-md text-xs font-semibold")}>{cta}</span>
          : <span className={cn(buttonVariants({ variant: "dashed", size: "block" }), "flex h-10 w-full items-center justify-center rounded-md text-xs font-semibold")}>Opens soon</span>}
        </div>
      </div>
    </article>
  );
  if (jb || !can) return inner;
  return <Link href={ROUTES.campaignQuest(quest.id, quest.title)} className="block h-full w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">{inner}</Link>;
}