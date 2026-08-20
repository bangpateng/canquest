"use client";

import Image from "next/image";
import { Lock, Sparkles, Trophy, Zap, ArrowUpRight, Flame } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

/**
 * Hero — premium fintech/crypto layout, inspired by the reference deck.
 *
 * Layers (top → bottom):
 *  1. Pill badge (eyebrow) with pulsing dot
 *  2. Headline with a richer green→cyan gradient + glow
 *  3. CTAs (Launch App · How it works)
 *  4. Stat chips strip — credibility markers under the CTAs (a recurring
 *     motif in the reference designs)
 *  5. Floating dashboard cluster:
 *       - Central "Total balance" card with an inline sparkline SVG
 *       - Accent cards (Lock tier, Active campaign, Leaderboard) that float
 *         around it on desktop and become a swipe strip on mobile
 *
 * Colors stay on the Canton green brand palette (no magenta), per decision.
 */

type AccentCard = {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  /** Desktop absolute position classes (only used at md+). */
  desktop?: string;
  delay?: string;
  duration?: string;
  /** Conic progress value 0..1 for the ring shown next to the icon. */
  progress?: number;
  /** Optional small status badge (e.g. "Live", "Tier 2"). */
  badge?: string;
};

const ACCENT_CARDS: AccentCard[] = [
  {
    icon: <Lock className="h-4 w-4 text-canton" aria-hidden />,
    label: "Lock to join",
    value: "5,000 CC",
    hint: "Lock CC to join campaigns",
    desktop: "left-[1%] top-[8%]",
    delay: "0s",
    duration: "7s",
    progress: 0.72,
  },
  {
    icon: <Sparkles className="h-4 w-4 text-canton" aria-hidden />,
    label: "Active campaign",
    value: "Partner Beta",
    hint: "Early access · ends in 3d",
    desktop: "right-[1%] top-[2%]",
    delay: "1.2s",
    duration: "6.5s",
    badge: "Live",
  },
  {
    icon: <Trophy className="h-4 w-4 text-canton" aria-hidden />,
    label: "Leaderboard",
    value: "Rank #42",
    hint: "Top 5% this season",
    desktop: "bottom-[2%] left-[5%]",
    delay: "0.6s",
    duration: "8s",
    progress: 0.95,
  },
];

export function LandingHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-aurora" aria-hidden />
      <div className="grid-overlay absolute inset-0 opacity-60" aria-hidden />

      <LandingShell className="relative pb-28 pt-20 text-center md:pb-36 md:pt-28">
        {/* Headline — richer gradient */}
        <h1 className="glow-text mx-auto mt-6 max-w-3xl text-[2.25rem] font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          Get early access to{" "}
          <span className="text-gradient-hero">partner projects</span> on Canton
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-lg">
          CanQuest connects Canton ecosystem projects with verified early users.
        </p>

        {/* CTAs */}
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LaunchAppButton size="lg" className="shimmer w-full rounded-full px-8 sm:w-auto" />
          <a href="#lock" className="inline-flex w-full justify-center sm:w-auto">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex w-full rounded-full sm:w-auto",
              )}
            >
              How it works
            </span>
          </a>
        </div>

        {/* Floating dashboard cards cluster */}
        <div className="relative mx-auto mt-14 max-w-5xl md:mt-16">
          {/* Central glow behind the cluster */}
          <div
            className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-72 max-w-2xl rounded-full opacity-60 blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at center, rgb(var(--canton-rgb) / 0.35), transparent 70%)",
            }}
            aria-hidden
          />

          <div className="relative">
            {/* Primary central card — wallet snapshot with sparkline */}
            <div className="hero-card gradient-hairline float-y relative mx-auto max-w-md overflow-hidden rounded-2xl p-5 text-left ring-1 ring-[var(--border)]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
                  <Zap className="h-3.5 w-3.5 text-canton" aria-hidden />
                  Total balance
                </span>
                <span className="rounded-full bg-canton-subtle px-2 py-0.5 text-[10px] font-semibold text-canton">
                  Wallet
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="type-stat">12,480.50</span>
                  <span className="text-sm font-semibold text-canton">CC</span>
                </div>
                {/* Sparkline — inline so no asset dependency. */}
                <Sparkline className="h-8 w-24 text-canton" />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <Image
                    src="https://api.canquest.cc/api/uploads/token-logo/USDCx"
                    alt="USDCx"
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-lg"
                  />
                  <div>
                    <p className="font-medium leading-none">2,140.00</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">USDCx</p>
                  </div>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-canton-subtle px-2 py-1 text-xs font-medium text-canton">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  +8.2%
                </span>
              </div>
            </div>

            {/* Mobile: horizontally-scrollable strip of accent cards.
                Absolute positioning would overflow a narrow viewport, so on
                small screens the cards sit in normal flow and swipe sideways.
                Hidden at md+ where the floating version takes over. */}
            <div
              className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
              aria-label="Highlights"
            >
              {ACCENT_CARDS.map((card) => (
                <AccentCardView
                  key={card.label}
                  card={card}
                  className="w-[10.5rem] shrink-0 snap-start"
                />
              ))}
            </div>

            {/* Desktop: floating accent cards positioned absolutely around
                the central card. */}
            {ACCENT_CARDS.map((card) => (
              <AccentCardView
                key={card.label}
                card={card}
                className={cn(
                  "hero-card-float absolute z-10 hidden w-44 md:block",
                  card.desktop,
                )}
                style={{
                  animationDelay: card.delay,
                  animationDuration: card.duration,
                }}
              />
            ))}
          </div>
        </div>
      </LandingShell>
    </section>
  );
}

/** A small glass card with icon (+ optional progress ring), label, value,
 *  hint, and an optional status badge. Used by both the mobile strip and the
 *  desktop floating cards so styling stays in sync. */
function AccentCardView({
  card,
  className,
  style,
}: {
  card: AccentCard;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "hero-card gradient-hairline rounded-xl p-3.5 text-left ring-1 ring-[var(--border)]",
        className,
      )}
      style={style}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          {typeof card.progress === "number" ? (
            // Progress ring wraps the icon: conic gradient outer disc + inner
            // mask disc, with the icon on top.
            <span className="progress-ring relative flex h-7 w-7 items-center justify-center rounded-full">
              <span className="absolute inset-[2px] flex items-center justify-center rounded-full bg-[var(--card)]">
                {card.icon}
              </span>
            </span>
          ) : (
            <span className="flex h-7 w-7 items-center justify-center">
              {card.icon}
            </span>
          )}
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {card.label}
          </span>
        </span>
        {card.badge ? (
          <span className="flex items-center gap-1 rounded-full bg-canton-subtle px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-canton">
            {card.badge === "Live" ? (
              <Flame className="h-2.5 w-2.5" aria-hidden />
            ) : null}
            {card.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">{card.value}</p>
      {card.hint ? (
        <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">{card.hint}</p>
      ) : null}
    </div>
  );
}

/** Inline SVG sparkline — no asset dependency. Sits next to the balance
 *  figure in the central card to add the data-viz texture from the refs. */
function Sparkline({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 32"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--canton-rgb))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(var(--canton-rgb))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 26 L12 22 L24 24 L36 16 L48 18 L60 10 L72 12 L84 5 L96 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M0 26 L12 22 L24 24 L36 16 L48 18 L60 10 L72 12 L84 5 L96 7 L96 32 L0 32 Z"
        fill="url(#spark-fill)"
      />
    </svg>
  );
}
