"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import Link from "next/link";
import { QuestReferralCard } from "@/components/app/quest/quest-referral-card";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { ROUTES } from "@/lib/routing/app-routes";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { Trophy, Zap } from "lucide-react";
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
      setHubLoading(true);
      setMeLoading(true);
      setHubError(null);

      try {
        const fetchOpts = {
          credentials: "include" as const,
          cache: "no-store" as const,
          signal: AbortSignal.timeout(12_000),
        };
        const [hubRes, meRes] = await Promise.all([
          fetch("/api/quests/earn-hub", fetchOpts),
          fetch("/api/me", fetchOpts),
        ]);

        if (!cancelled) {
          if (meRes.ok) {
            const me = (await meRes.json()) as {
              cantonPartyId?: string | null;
              twitterUsername?: string | null;
              earnPoints?: number;
            };
            setPartyId(
              hasRealWallet(me.cantonPartyId) ? me.cantonPartyId!.trim() : null,
            );
            setTwitterUsername(me.twitterUsername?.trim() || null);
            setEarnPoints(typeof me.earnPoints === "number" ? me.earnPoints : 0);
          } else {
            setPartyId(null);
          }
          setMeLoading(false);
        }

        if (!cancelled) {
          if (!hubRes.ok) {
            setHub(null);
            setHubError(
              hubRes.status === 404
                ? "Quest hub is not set up yet."
                : "Could not load Quest tasks.",
            );
          } else {
            const data = (await hubRes.json()) as Quest | null;
            if (data && typeof data === "object" && "id" in data) {
              setHub(data);
            } else {
              setHub(null);
              setHubError("Quest hub is not set up yet.");
            }
          }
          setHubLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHubError("Network error — refresh the page.");
          setHubLoading(false);
          setMeLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = hubLoading || meLoading;

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-5 md:space-y-6 font-sans">
      {/* Points Balance — Premium Hero Bento Card */}
      <section
        className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40"
        aria-label="Points balance"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/[0.05] bg-white/[0.02] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
          <h2 className="text-base sm:text-lg font-semibold tracking-tight text-white">Your points</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/10 px-3 py-1.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[var(--primary)] border border-[var(--primary)]/20">
            <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
            Lifetime
          </span>
        </div>

        <div className="relative px-5 py-8 sm:px-6 sm:py-10 md:px-8 md:py-12">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.10),transparent_60%)]"
            aria-hidden
          />
          <div className="relative">
            {loading ? (
              <div className="flex h-16 items-center gap-3 text-sm sm:text-base font-medium text-slate-400">
                <LoadingSpinner size="lg" />
                Loading…
              </div>
            ) : (
              <>
                <p className="text-4xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
                  {earnPoints.toLocaleString()}
                  <span className="ml-2 text-lg font-semibold text-[var(--primary)] sm:ml-3 sm:text-xl md:text-2xl lg:text-3xl">pts</span>
                </p>
                <p className="mt-3 max-w-2xl text-xs sm:text-sm font-normal leading-relaxed text-slate-400 sm:mt-4">
                  Quest tasks, friend invites, partner Earn campaigns, and spin wins.
                </p>
              </>
            )}
          </div>

          <div className="relative mt-6 flex flex-wrap items-center gap-3 border-t border-white/[0.05] pt-6 sm:mt-8 sm:pt-8">
            <Link
              href={ROUTES.leaderboard}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 sm:px-5 sm:py-3"
            >
              <Trophy className="h-4 w-4 text-[var(--primary)]" />
              Leaderboard
            </Link>
            <Link
              href={ROUTES.spinReward}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-400 transition-all duration-200 hover:border-white/[0.15] hover:text-white hover:bg-white/[0.06] sm:px-5 sm:py-3"
            >
              Spend points
            </Link>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-base font-medium text-slate-400 sm:py-24">
          <LoadingSpinner size="lg" />
          Loading tasks…
        </div>
      ) : hubError || !hub ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 text-center sm:py-20">
          <p className="text-sm font-medium text-slate-500">{hubError ?? "No Quest hub yet."}</p>
        </div>
      ) : (
        <>
          {hub.status === "ACTIVE" ? (
            hub.tasks.length > 0 ? (
              <QuestTaskPanel
                quest={{ ...hub, questKind: "EARN_HUB" }}
                viewerPartyId={partyId}
                viewerTwitterUsername={twitterUsername}
                onPointsEarned={() => {
                  void fetch("/api/me", { credentials: "include", cache: "no-store" })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((me: { earnPoints?: number } | null) => {
                      if (me && typeof me.earnPoints === "number") {
                        setEarnPoints(me.earnPoints);
                      }
                    })
                    .catch(() => undefined);
                }}
              />
            ) : (
              <p className="py-16 text-center text-sm font-medium text-slate-500">
                No tasks yet. Check back soon.
              </p>
            )
          ) : (
            <p className="py-16 text-center text-sm font-medium text-slate-500">
              Quest is not active right now.
            </p>
          )}

          <QuestReferralCard />
        </>
      )}

      {/* Footer Nav Strip */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 backdrop-blur-xl sm:px-6 sm:py-5 md:px-8">
        <Link
          href={ROUTES.earnHub}
          className="text-base font-semibold text-white transition-colors hover:text-canton"
        >
          Earn
        </Link>
        <Link
          href={ROUTES.campaignQuests}
          className="group flex items-center gap-1.5 text-sm font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
        >
          Partner campaigns
        </Link>
      </div>
    </div>
  );
}
