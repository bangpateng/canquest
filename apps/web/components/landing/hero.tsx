"use client";

import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

const STEPS = [
  "Prove you're a real user",
  "Complete verified tasks",
  "Earn real on-chain rewards",
] as const;

export function LandingHero() {
  return (
    <section className="relative border-b border-[var(--border)]">
      <div className="gradient-mesh absolute inset-0 opacity-40" aria-hidden />

      <LandingShell className="relative py-16 text-center md:py-20 lg:py-24">
        <p className="type-eyebrow-brand">On-chain quests, built for real users</p>

        <h1 className="type-display mx-auto mt-4 max-w-2xl text-[2rem] font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
          Quests that respect{" "}
          <span className="text-gradient-brand">real people.</span>
        </h1>

        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-[var(--muted-foreground)]">
          Every account is human-verified and sybil-resistant — so the rewards you
          earn actually mean something. Partner missions, daily tasks, and a Canton
          wallet, all in one account.
        </p>

        <ol className="mx-auto mt-10 flex max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-8">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-center justify-center gap-2 text-sm text-[var(--foreground)]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canton-subtle text-xs font-bold text-canton">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LaunchAppButton size="lg" className="w-full rounded-full px-8 sm:w-auto" />
          <a href="#integrity" className="inline-flex w-full justify-center sm:w-auto">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex w-full rounded-full sm:w-auto",
              )}
            >
              Why it&apos;s fair
            </span>
          </a>
        </div>
      </LandingShell>
    </section>
  );
}
