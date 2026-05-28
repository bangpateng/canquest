"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HERO_STATS = [
  { label: "Partner campaigns", value: "Earn hub" },
  { label: "Rewards", value: "CC on Canton" },
  { label: "In one app", value: "Quest · Wallet" },
] as const;

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh particle-field absolute inset-0 opacity-80 max-sm:opacity-50" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-[min(100%,42rem)] -translate-x-1/2 rounded-full opacity-35 blur-3xl max-sm:opacity-20"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--canton-rgb) / 0.28) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <LandingShell className="relative flex min-h-[min(88vh,52rem)] flex-col items-center justify-center gap-8 py-16 text-center sm:py-20 md:gap-10 md:py-24">
        <div className="landing-fade-in inline-flex items-center gap-2 rounded-full border border-canton-muted bg-canton-subtle/80 px-4 py-1.5 text-xs font-semibold text-canton backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          CanQuest · Canton Network
        </div>

        <div className="landing-fade-in landing-fade-in-delay-1 mx-auto max-w-4xl space-y-5">
          <h1 className="type-display text-[2rem] font-bold leading-[1.06] tracking-tight sm:text-5xl sm:leading-[1.05] lg:text-[3.25rem]">
            Partner campaigns on Canton.{" "}
            <span className="text-gradient-brand">Social missions. CC rewards.</span>
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-lg sm:leading-relaxed">
            Join live partner programs — follow on X, join Telegram or Discord, earn quest
            points, and claim CC to your wallet. Daily tasks and Spin Reward live in the same
            app.
          </p>
        </div>

        <div className="landing-fade-in landing-fade-in-delay-2 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
          <LaunchAppButton
            size="lg"
            showArrow
            className="w-full rounded-full px-7 py-3.5 text-base font-bold shadow-[0_0_40px_rgb(var(--canton-rgb)/0.3)] sm:w-auto"
          />
          <a href="#campaigns" className="inline-flex w-full justify-center sm:w-auto">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex w-full gap-2 rounded-full border-[var(--border)] bg-[var(--card)]/60 backdrop-blur-sm sm:w-auto",
              )}
            >
              Browse campaigns
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </span>
          </a>
        </div>

        <dl className="landing-fade-in landing-fade-in-delay-3 grid w-full max-w-2xl grid-cols-3 gap-3 border-y border-[var(--border)]/80 py-6 sm:gap-6">
          {HERO_STATS.map(({ label, value }) => (
            <div key={label} className="min-w-0 px-1">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-xs">
                {label}
              </dt>
              <dd className="mt-1 truncate text-sm font-bold text-[var(--foreground)] sm:text-base">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="landing-fade-in landing-fade-in-delay-4 text-xs text-[var(--muted-foreground)]">
          Overview · Quest · Earn · Spin Reward · Wallet · Leaderboard
        </p>
      </LandingShell>
    </section>
  );
}
