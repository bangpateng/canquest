import { ArrowRight } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingSection } from "@/components/landing/landing-section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LandingCtaSection() {
  return (
    <LandingSection className="border-b-0">
      <div className="relative overflow-hidden rounded-3xl border border-[var(--primary)]/25 bg-gradient-to-br from-[var(--primary)]/12 via-[var(--card)] to-[var(--card)] px-6 py-10 text-center sm:px-10 sm:py-12 md:px-14">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-40 blur-3xl"
          style={{
            background: "radial-gradient(circle, rgb(var(--canton-rgb) / 0.35), transparent 70%)",
          }}
          aria-hidden
        />
        <p className="type-eyebrow-brand">Get started</p>
        <h2 className="type-display mx-auto mt-3 max-w-xl text-2xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-3xl">
          Join campaigns and claim CC on Canton
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
          Sign in to complete partner missions, earn points, and use your wallet in one app.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LaunchAppButton
            size="lg"
            showArrow
            className="w-full rounded-full px-8 sm:w-auto"
          />
          <a href="#campaigns" className="inline-flex w-full justify-center sm:w-auto">
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "inline-flex w-full gap-2 rounded-full sm:w-auto",
              )}
            >
              Browse campaigns
              <ArrowRight className="h-4 w-4" />
            </span>
          </a>
        </div>
      </div>
    </LandingSection>
  );
}
