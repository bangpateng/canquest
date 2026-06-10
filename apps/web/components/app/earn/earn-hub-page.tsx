"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import Link from "next/link";
import { QuestReferralCard } from "@/components/app/quest/quest-referral-card";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { ROUTES } from "@/lib/routing/app-routes";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { Gift, Sparkles, Trophy, TrendingUp, Zap } from "lucide-react";
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

      {/* ── Hero Card — Split Layout: Left (Points) + Right (Profile) ────── */}
      <section
        className="relative w-full max-w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50"
        aria-label="Points balance"
      >
        {/* Background glow — right side accent */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.10),transparent_60%)]"
          aria-hidden
        />

        <div className="relative">
          {/* Header */}
          <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/20">
                <TrendingUp className="h-5 w-5 text-[var(--primary)]" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight text-white">
                  Quest Hub
                </h2>
                <p className="text-xs text-slate-500">Daily tasks & rewards</p>
              </div>
            </div>
          </div>

          {/* Body — Full-width Points Display */}
          <div className="px-5 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10">
            {loading ? (
              <div className="flex h-16 items-center gap-3 text-sm sm:text-base font-medium text-slate-400">
                <LoadingSpinner size="lg" />
                Loading…
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
                  Total Points Earned
                </p>
                <p className="text-4xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-5xl md:text-6xl glow-text">
                  {earnPoints.toLocaleString()}
                  <span className="ml-2 text-base font-semibold text-[var(--primary)] sm:ml-2.5 sm:text-lg md:text-xl">
                    pts
                  </span>
                </p>
                <p className="mt-3 text-xs sm:text-sm font-normal leading-relaxed text-slate-400 sm:mt-4 max-w-md">
                  Complete daily tasks, invite friends, join partner campaigns, and spin the wheel to earn more.
                </p>

                {/* Quick Actions */}
                <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
                  <Link
                    href={ROUTES.leaderboard}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 hover:shadow-[0_0_20px_rgb(var(--canton-rgb)/0.08)] sm:px-5 sm:py-3"
                  >
                    <Trophy className="h-4 w-4 text-[var(--primary)]" />
                    View Leaderboard
                  </Link>
                  <Link
                    href={ROUTES.spinReward}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-slate-400 transition-all duration-200 hover:border-white/[0.15] hover:text-white hover:bg-white/[0.05] sm:px-5 sm:py-3"
                  >
                    <Gift className="h-4 w-4" />
                    Spend Points
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Tasks / Hub Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-base font-medium text-slate-400 sm:py-24">
          <LoadingSpinner size="lg" />
          Loading tasks…
        </div>
      ) : hubError || !hub ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 text-center sm:py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
              <Zap className="h-8 w-8 text-slate-500" />
            </div>
            <p className="text-sm font-medium text-slate-500">
              {hubError ?? "No Quest hub yet."}
            </p>
          </div>
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
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                    <Sparkles className="h-8 w-8 text-slate-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-500">
                    No tasks yet. Check back soon.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 text-center">
              <p className="text-sm font-medium text-slate-500">
                Quest is not active right now.
              </p>
            </div>
          )}

          <QuestReferralCard />
        </>
      )}

      {/* ── Footer Nav ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 backdrop-blur-xl sm:px-6 sm:py-5 md:px-8">
        <Link
          href={ROUTES.earnHub}
          className="text-base font-semibold text-white transition-colors hover:text-canton"
        >
          Quest Hub
        </Link>
        <Link
          href={ROUTES.campaignQuests}
          className="group flex items-center gap-1.5 text-sm font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
        >
          <Sparkles className="h-4 w-4" />
          Partner Campaigns
        </Link>
      </div>
    </div>
  );
}