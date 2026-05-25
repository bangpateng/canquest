"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh particle-field absolute inset-0 opacity-80 max-sm:opacity-50" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-[min(100%,36rem)] -translate-x-1/2 rounded-full opacity-30 blur-3xl max-sm:opacity-20"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--canton-rgb) / 0.25) 0%, transparent 70%)",
        }}
      />

      <LandingShell className="relative flex flex-col items-center gap-8 py-12 text-center md:py-16">
        <div className="landing-fade-in inline-flex items-center gap-2 rounded-full border border-canton-muted bg-canton-subtle/80 px-4 py-1.5 text-xs font-semibold text-canton backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          CanQuest · Canton Network
        </div>

        <h1 className="landing-fade-in landing-fade-in-delay-1 type-hero max-w-3xl">
          Daily quests. Partner campaigns.{" "}
          <span className="text-gradient-brand">Rewards on-chain.</span>
        </h1>

        <p className="landing-fade-in landing-fade-in-delay-2 max-w-2xl text-base leading-relaxed text-[var(--muted-foreground)] md:text-lg">
          Complete verified tasks, join partner Earn campaigns, climb the leaderboard, and
          receive CC in your Canton wallet — all in one app.
        </p>

        <div className="landing-fade-in landing-fade-in-delay-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
          <LaunchAppButton
            size="lg"
            showArrow
            className="rounded-full px-7 py-3.5 text-base font-bold shadow-[0_0_40px_rgb(var(--canton-rgb)/0.3)]"
          />
          <a href="#campaigns" className="inline-flex justify-center">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex gap-2 rounded-full border-[var(--border)] bg-[var(--card)]/60 backdrop-blur-sm",
              )}
            >
              Partner campaigns
              <ArrowRight className="h-4 w-4" />
            </span>
          </a>
        </div>

        <p className="landing-fade-in landing-fade-in-delay-4 text-xs text-[var(--muted-foreground)]">
          Sign in to access Overview, Quest, Earn, Spin Reward, Wallet, and Leaderboard.
        </p>
      </LandingShell>
    </section>
  );
}
