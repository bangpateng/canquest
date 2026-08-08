import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";

/** Closing CTA — single line, no fluff. */
export function CtaSection() {
  return (
    <section className="border-b border-[var(--border)] py-16 md:py-24">
      <LandingShell>
        <div className="gradient-hairline relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-12 md:py-16">
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 50% 0%, rgb(var(--canton-rgb) / 0.18), transparent 70%)",
            }}
            aria-hidden
          />
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl md:text-4xl">
            Lock CC and unlock partner campaigns.
          </h2>
          <div className="mt-8 flex justify-center">
            <LaunchAppButton
              size="lg"
              className="shimmer w-full rounded-full px-8 sm:w-auto"
            />
          </div>
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Invite-gated · requires a team invite code
          </p>
        </div>
      </LandingShell>
    </section>
  );
}
