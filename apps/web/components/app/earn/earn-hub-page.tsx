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

/**
 * CanQuest daily tasks hub — route /quest, menu Quest (see docs/EARN_PRODUCT_SPEC.md).
 */
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
    <div className="space-y-8 md:space-y-10">
      {/* Points balance — matches Tasks panel chrome */}
      <section
        className="overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900/40 backdrop-blur-xl"
        aria-label="Points balance"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-6 py-5 sm:px-8">
          <p className="text-sm font-medium text-slate-400">Your points</p>
          <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[var(--primary)]/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-canton">
            <Zap className="h-4 w-4" aria-hidden />
            Lifetime
          </span>
        </div>

        <div className="relative px-6 py-10 sm:px-8 sm:py-12">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.10),transparent_55%)]"
            aria-hidden
          />
          <div className="relative">
            {loading ? (
              <div className="flex h-16 items-center gap-3 text-base font-medium text-slate-400">
                <LoadingSpinner size="lg" />
                Loading…
              </div>
            ) : (
              <>
                <p className="text-4xl font-bold tabular-nums leading-none tracking-tighter text-slate-100 sm:text-5xl md:text-6xl lg:text-7xl">
                  {earnPoints.toLocaleString()}
                  <span className="ml-3 text-lg font-semibold text-canton sm:text-xl md:text-2xl">pts</span>
                </p>
                <p className="mt-4 max-w-lg text-sm font-medium leading-relaxed text-slate-500 sm:text-base">
                  Quest tasks, friend invites, partner Earn campaigns, and spin wins.
                </p>
              </>
            )}
          </div>

          <div className="relative mt-8 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-8">
            <Link
              href={ROUTES.leaderboard}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-slate-100 transition-all duration-200 hover:border-[var(--primary)]/25 hover:bg-[var(--primary)]/8"
            >
              <Trophy className="h-4 w-4 text-canton" />
              Leaderboard
            </Link>
            <Link
              href={ROUTES.spinReward}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-slate-400 transition-all duration-200 hover:border-white/[0.12] hover:text-slate-100"
            >
              Spend points
            </Link>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-24 text-base font-medium text-slate-400">
          <LoadingSpinner size="lg" />
          Loading tasks…
        </div>
      ) : hubError || !hub ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] py-20 text-center">
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
          ) : hub.status !== "ACTIVE" ? (
            <p className="py-16 text-center text-sm font-medium text-slate-500">
              Quest is not active right now.
            </p>
          ) : null}

          <QuestReferralCard />
        </>
      )}

      <div className="flex items-center justify-between gap-4 rounded-3xl border border-white/[0.08] bg-white/[0.02] px-6 py-5 text-base backdrop-blur-xl sm:px-8">
        <Link
          href={ROUTES.earnHub}
          className="font-semibold text-slate-100 transition-colors hover:text-canton"
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
