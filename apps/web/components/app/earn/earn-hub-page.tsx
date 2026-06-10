"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import Link from "next/link";
import { QuestReferralCard } from "@/components/app/quest/quest-referral-card";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { ROUTES } from "@/lib/routing/app-routes";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { useEffect, useState } from "react";

export function EarnHubPage() {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [twitterUsername, setTwitterUsername] = useState<string | null>(null);
  const [earnPoints, setEarnPoints] = useState(0);
  const [hub, setHub] = useState<Quest | null>(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setHubLoading(true); setMeLoading(true); setHubError(null);
      try {
        const o = { credentials: "include" as const, cache: "no-store" as const, signal: AbortSignal.timeout(12000) };
        const [h, m] = await Promise.all([fetch("/api/quests/earn-hub", o), fetch("/api/me", o)]);
        if (!cancelled) {
          if (m.ok) { const me = await m.json() as any; setPartyId(hasRealWallet(me.cantonPartyId) ? me.cantonPartyId!.trim() : null); setTwitterUsername(me.twitterUsername?.trim() || null); setEarnPoints(typeof me.earnPoints === "number" ? me.earnPoints : 0); } else setPartyId(null);
          setMeLoading(false);
        }
        if (!cancelled) {
          if (!h.ok) { setHub(null); setHubError(h.status === 404 ? "Quest hub not set up." : "Could not load tasks."); }
          else { const d = await h.json() as Quest | null; if (d && typeof d === "object" && "id" in d) setHub(d); else { setHub(null); setHubError("Quest hub not set up."); } }
          setHubLoading(false);
        }
      } catch { if (!cancelled) { setHubError("Network error."); setHubLoading(false); setMeLoading(false); } }
    }
    void load(); return () => { cancelled = true; };
  }, []);

  const loading = hubLoading || meLoading;

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 md:space-y-5">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3 md:px-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Your Points</h2>
        </div>
        <div className="px-4 py-5 md:px-5 md:py-6">
          {loading ? <LoadingSpinner size="lg" />
          : <><p className="text-3xl font-bold tabular-nums text-[var(--foreground)] md:text-4xl">{earnPoints.toLocaleString()} <span className="text-base font-semibold text-[var(--primary)]">pts</span></p>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">Earn from quests, invites & spins</p>
            <div className="mt-4 flex gap-2">
              <Link href={ROUTES.leaderboard} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:border-[var(--primary)]/30 transition-colors">Leaderboard</Link>
              <Link href={ROUTES.spinReward} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Spend Points</Link>
            </div>
          </>}
        </div>
      </section>

      {loading ? <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      : hubError || !hub ? <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] py-16 text-center text-sm text-[var(--muted-foreground)]">{hubError ?? "No Quest hub yet."}</div>
      : hub.status === "ACTIVE" ? hub.tasks.length > 0 ? <QuestTaskPanel quest={{ ...hub, questKind: "EARN_HUB" }} viewerPartyId={partyId} viewerTwitterUsername={twitterUsername} onPointsEarned={() => { void fetch("/api/me", { credentials: "include", cache: "no-store" }).then(r => r.ok ? r.json() : null).then((me: any) => { if (me && typeof me.earnPoints === "number") setEarnPoints(me.earnPoints); }).catch(() => undefined); }} />
        : <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] py-16 text-center text-sm text-[var(--muted-foreground)]">No tasks yet.</div>
      : <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] py-16 text-center text-sm text-[var(--muted-foreground)]">Quest not active.</div>}

      <QuestReferralCard />
    </div>
  );
}