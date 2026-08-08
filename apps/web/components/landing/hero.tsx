"use client";

import { LandingImage } from "@/components/landing/landing-image";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-aurora" aria-hidden />
      <div className="grid-overlay absolute inset-0 opacity-60" aria-hidden />

      <LandingShell className="relative pb-20 pt-20 text-center md:pb-28 md:pt-28">
        <h1 className="glow-text mx-auto mt-6 max-w-3xl text-[2.25rem] font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          Get early access to{" "}
          <span className="text-gradient-brand">partner projects</span> on Canton
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-lg">
          CanQuest connects Canton ecosystem projects with verified early users.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LaunchAppButton
            size="lg"
            className="shimmer w-full rounded-full px-8 sm:w-auto"
          />
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

        <div className="float-y mx-auto mt-16 max-w-4xl md:mt-20">
          <LandingImage
            src="/landing/hero.svg"
            alt="CanQuest app dashboard showing CC balance, lock and active campaigns"
            ratio="16/10"
          />
        </div>
      </LandingShell>
    </section>
  );
}
