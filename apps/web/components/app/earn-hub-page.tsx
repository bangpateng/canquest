"use client";

import Link from "next/link";
import { QuestReferralCard } from "@/components/app/quest-referral-card";
import { QuestTaskPanel } from "@/components/app/quest-task-panel";
import { PageHeader } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import type { Quest } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import { WalletCreatePromptBanner } from "@/components/app/wallet-create-prompt";
import { ArrowRight, Loader2, Trophy, Zap } from "lucide-react";
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
            setPartyId(me.cantonPartyId?.trim() || null);
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
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Quest"
        description={
          <>
            Complete tasks, earn points, and redeem rewards. Partner missions are under{" "}
            <Link
              href={ROUTES.campaignQuests}
              className="font-medium text-canton underline-offset-2 hover:underline"
            >
              Partner campaigns
            </Link>
            .
          </>
        }
      />

      {/* Points balance — matches Tasks panel chrome */}
      <section
        className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40"
        aria-label="Points balance"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Your points</p>
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-canton">
            <Zap className="h-3 w-3" aria-hidden />
            Lifetime
          </span>
        </div>

        <div className="relative px-4 py-5 sm:px-6">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.12),transparent_55%)]"
            aria-hidden
          />
          <div className="relative">
            {loading ? (
              <div className="flex h-12 items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-5 w-5 animate-spin text-canton" />
                Loading…
              </div>
            ) : (
              <>
                <p className="text-4xl font-semibold tabular-nums leading-none tracking-tight text-[var(--foreground)] sm:text-[44px]">
                  {earnPoints.toLocaleString()}
                  <span className="ml-1.5 text-lg font-medium text-canton sm:text-xl">pts</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  Quest tasks, friend invites, partner Earn campaigns, and spin wins.
                </p>
              </>
            )}
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)]/80 pt-4">
            <Link
              href={ROUTES.leaderboard}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/35 hover:bg-[var(--primary)]/8"
            >
              <Trophy className="h-3.5 w-3.5 text-canton" />
              Leaderboard
            </Link>
            <Link
              href={ROUTES.spinReward}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)]"
            >
              Spend points
              <ArrowRight className="h-3 w-5" />
            </Link>
          </div>
        </div>
      </section>

      {!loading ? <QuestReferralCard /> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-5 w-5 animate-spin text-canton" />
          Loading tasks…
        </div>
      ) : hubError || !hub ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{hubError ?? "No Quest hub yet."}</p>
        </div>
      ) : (
        <>
          {!partyId ? <WalletCreatePromptBanner /> : null}

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
              <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                No tasks yet. Check back soon.
              </p>
            )
          ) : hub.status !== "ACTIVE" ? (
            <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">
              Quest is not active right now.
            </p>
          ) : null}
        </>
      )}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-4 py-3.5 text-sm">
        <Link
          href={ROUTES.earnHub}
          className="font-medium text-[var(--foreground)] transition-colors hover:text-canton"
        >
          Earn
        </Link>
        <Link
          href={ROUTES.campaignQuests}
          className="group flex items-center gap-1 text-xs font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
        >
          Partner campaigns
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
