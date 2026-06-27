"use client";

import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

const STEPS = [
  "Lock 30 CC on-chain",
  "Get Full access",
  "Earn campaign rewards",
] as const;

export function LandingHero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh absolute inset-0 opacity-70" aria-hidden />

      <LandingShell className="relative py-16 text-center md:py-20 lg:py-24">
        <p className="type-eyebrow-brand">Non-custodial CC lock · Canton-native</p>

        <h1 className="type-display mx-auto mt-4 max-w-2xl text-[2rem] font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
          Lock CC.{" "}
          <span className="text-gradient-brand">Unlock real campaigns.</span>
        </h1>

        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-[var(--muted-foreground)]">
          Commit CC from your own wallet to reach Full access and join partner campaigns —
          invite codes, early drops, and CC rewards for genuine participants, not bots.
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
          <a href="#lock" className="inline-flex w-full justify-center sm:w-auto">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex w-full rounded-full sm:w-auto",
              )}
            >
              How locking works
            </span>
          </a>
        </div>
      </LandingShell>
    </section>
  );
}
