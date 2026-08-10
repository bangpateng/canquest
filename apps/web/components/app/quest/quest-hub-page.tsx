"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import Link from "next/link";
import { QuestReferralCard } from "@/components/app/quest/quest-referral-card";
import { QuestTaskPanel } from "@/components/app/quest/quest-task-panel";
import { ROUTES } from "@/lib/routing/app-routes";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import { useMe } from "@/lib/hooks/use-me";
import type { Quest } from "@/lib/quest/quest-types";
import { Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

export function QuestHubPage() {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [twitterUsername, setTwitterUsername] = useState<string | null>(null);
  const [pointsRemaining, setPointsRemaining] = useState(0);
  const [hub, setHub] = useState<Quest | null>(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);

  // Profil user via cache global `useMe` — ter-dedup lintas halaman.
  // Sebelumnya `/api/me` di-fetch manual di dalam Promise.all (duplikat dengan
  // QuestTaskPanel child yang juga fetch /api/me).
  const { me, isLoading: meLoading } = useMe();
  useEffect(() => {
    setPartyId(
      hasRealWallet(me?.cantonPartyId) ? me!.cantonPartyId!.trim() : null,
    );
    setTwitterUsername(me?.twitterUsername?.trim() || null);
  }, [me]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setHubLoading(true);
      setHubError(null);

      try {
        const fetchOpts = {
          credentials: "include" as const,
          cache: "no-store" as const,
          signal: AbortSignal.timeout(12_000),
        };
        // `/api/me` ditangani useMe() di atas — di sini hanya hub + points.
        const [hubRes, pointsRes] = await Promise.all([
          fetch("/api/quests/earn-hub", fetchOpts),
          fetch("/api/points", fetchOpts),
        ]);

        if (!cancelled) {
          if (pointsRes.ok) {
            const pts = (await pointsRes.json()) as { remaining?: number };
            setPointsRemaining(
              typeof pts.remaining === "number" ? pts.remaining : 0,
            );
          }
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

      {/* ── Points hero — icon-led, matches dashboard PointsCard ──────── */}
      <Card
        interactive
        className="w-full max-w-full overflow-hidden p-6 sm:p-7"
        aria-label="Points balance"
      >
        <div>
          {loading ? (
            <div className="flex h-12 items-center">
              <LoadingSpinner size="lg" tone="muted" />
            </div>
          ) : (
            <>
              {/* Icon + eyebrow label */}
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/15">
                  <Sparkles className="h-4 w-4 text-canton" aria-hidden />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Quest Hub · Available Points
                </p>
              </div>

              {/* Headline number */}
              <p className="mt-5 text-4xl font-extrabold tabular-nums leading-none tracking-tight text-[var(--foreground)] glow-text sm:text-5xl md:text-6xl">
                {pointsRemaining.toLocaleString()}
                <span className="ml-2 text-base font-semibold text-[var(--primary)] sm:ml-2.5 sm:text-lg md:text-xl">
                  pts
                </span>
              </p>
              <p className="mt-3 max-w-md text-xs font-normal leading-relaxed text-[var(--muted-foreground)] sm:mt-4 sm:text-sm">
                Your spendable balance. Complete daily tasks and invite friends to earn more.
              </p>

              {/* Quick Actions */}
              <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
                <Link
                  href={ROUTES.leaderboard}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-all duration-200 hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 sm:px-5 sm:py-3"
                >
                  View Leaderboard
                </Link>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ── Tasks / Hub Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-base font-medium text-[var(--muted-foreground)] sm:py-24">
          <LoadingSpinner size="lg" tone="muted" />
          Loading tasks…
        </div>
      ) : hubError || !hub ? (
        <Card className="border-dashed py-16 text-center sm:py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
              <Zap className="h-8 w-8 text-[var(--muted-foreground)]" />
            </div>
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {hubError ?? "No Quest hub yet."}
            </p>
          </div>
        </Card>
      ) : (
        <>
          {hub.status === "ACTIVE" ? (
            hub.tasks.length > 0 ? (
              <QuestTaskPanel
                quest={{ ...hub, questKind: "EARN_HUB" }}
                viewerPartyId={partyId}
                viewerTwitterUsername={twitterUsername}
                onPointsEarned={() => {
                  void fetch("/api/points", { credentials: "include", cache: "no-store" })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((pts: { remaining?: number } | null) => {
                      if (pts && typeof pts.remaining === "number") {
                        setPointsRemaining(pts.remaining);
                      }
                    })
                    .catch(() => undefined);
                }}
              />
            ) : (
              <Card className="border-dashed py-16 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
                    <Sparkles className="h-8 w-8 text-[var(--muted-foreground)]" />
                  </div>
                  <p className="text-sm font-medium text-[var(--muted-foreground)]">
                    No tasks yet. Check back soon.
                  </p>
                </div>
              </Card>
            )
          ) : (
            <Card className="border-dashed py-16 text-center">
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                Quest is not active right now.
              </p>
            </Card>
          )}

          <QuestReferralCard />
        </>
      )}

    </div>
  );
}