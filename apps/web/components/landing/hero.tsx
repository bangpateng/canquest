"use client";

import { ArrowRight } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingHeroPreview } from "@/components/landing/landing-hero-preview";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HERO_STATS = [
  { label: "Campaigns", value: "Partner-led" },
  { label: "Hub", value: "Daily tasks" },
  { label: "Payouts", value: "CC wallet" },
] as const;

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh particle-field absolute inset-0 opacity-70 max-sm:opacity-40" />
      <div
        className="pointer-events-none absolute -right-32 top-1/4 h-96 w-96 rounded-full opacity-25 blur-3xl"
        style={{
          background: "radial-gradient(circle, rgb(var(--canton-cyan-rgb) / 0.2), transparent 70%)",
        }}
        aria-hidden
      />

      <LandingShell className="relative py-14 sm:py-16 md:py-20 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="landing-fade-in type-eyebrow-brand">Canton Network</p>

            <h1 className="landing-fade-in landing-fade-in-delay-1 type-display mt-3 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-[2.75rem] lg:text-5xl">
              Quests that pay in{" "}
              <span className="text-gradient-brand">CC</span>
            </h1>

            <p className="landing-fade-in landing-fade-in-delay-2 mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--muted-foreground)] lg:mx-0 sm:text-lg">
              Finish branded missions, climb the board, and settle rewards to your party
              wallet — hub tasks and partner drops share one login.
            </p>

            <div className="landing-fade-in landing-fade-in-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <LaunchAppButton
                size="lg"
                showArrow
                className="w-full rounded-full px-7 font-bold shadow-[0_0_36px_rgb(var(--canton-rgb)/0.28)] sm:w-auto"
              />
              <a
                href="#campaigns"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "inline-flex w-full justify-center gap-2 rounded-full sm:w-auto",
                )}
              >
                See what&apos;s live
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </a>
            </div>

            <dl className="landing-fade-in landing-fade-in-delay-4 mt-10 grid grid-cols-3 gap-4 border-t border-[var(--border)] pt-8 lg:max-w-md">
              {HERO_STATS.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-bold text-[var(--foreground)]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="landing-fade-in landing-fade-in-delay-2 lg:justify-self-end">
            <LandingHeroPreview />
          </div>
        </div>
      </LandingShell>
    </section>
  );
}
