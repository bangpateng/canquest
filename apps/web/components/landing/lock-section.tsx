import { ArrowRight, Gift, Lock, Sparkles } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/** Default prod values — mirror LOCK_TIER_FULL & LOCK_TERM_OPTIONS (apps/api/.env).
 * Hard-coded for the public landing (no auth needed to explain the mechanism). */
const LOCK_TIER_FULL = 30;
const TERMS = ["7d", "15d", "30d"] as const;

const FLOW = [
  {
    icon: Lock,
    title: "Lock CC or redeem points",
    body: `Lock ${LOCK_TIER_FULL} CC from your wallet, or redeem points — your choice, set per event. CC stays yours the whole time — locked in your wallet and returned in full when you unlock.`,
  },
  {
    icon: Sparkles,
    title: "Reach Full access",
    body: `Once the requirement is met, your account is promoted to the Full access tier on-chain. No ticket, no approval — instant.`,
  },
  {
    icon: Gift,
    title: "Get early access",
    body: "Full access unlocks partner campaigns in Earn — early access to ecosystem projects, invite codes, and drops for verified users.",
  },
];

export function LockSection() {
  return (
    <LandingSection id="lock">
      <SectionHeader
        eyebrow="How it works"
        title=""
        align="center"
        description="How users earn access to partner campaigns. A commitment of your own CC (or points) that verifies genuine interest — set per event."
        className="mb-8 md:mb-10"
      />

      {/* ── 3-step flow ── */}
      <ol className="grid gap-4 md:grid-cols-3">
        {FLOW.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative">
              <article className="glass-card glass-card-hover h-full rounded-2xl p-6 ring-1 ring-[var(--border)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                    <Icon className="h-5 w-5 text-canton" aria-hidden />
                  </span>
                </div>
                <h3 className="type-section-title mt-4">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {step.body}
                </p>
              </article>
              {i < FLOW.length - 1 ? (
                <span
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-canton md:block"
                  aria-hidden
                >
                  <ArrowRight className="h-5 w-5" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* ── Progress / tier card ── */}
      <div className="glass-card mt-6 rounded-2xl p-6 ring-1 ring-[var(--border)] sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Lock threshold
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              The amount that promotes you from <em>None</em> to <em>Full access</em>.
            </p>
          </div>
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="type-stat text-gradient-brand">{LOCK_TIER_FULL}</span>
            <span className="text-sm font-medium text-canton">CC</span>
          </div>
        </div>

        {/* Progress bar with 30 marker */}
        <div className="mt-5">
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]/60">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[rgb(var(--canton-rgb)/0.6)] to-[rgb(var(--canton-rgb))]"
              style={{ width: "100%" }}
              aria-hidden
            />
            {/* marker line at the 30 point */}
            <span
              className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--primary-strong)] shadow-[0_0_8px_rgb(var(--canton-rgb)/0.6)]"
              style={{ left: "100%", transform: "translate(-100%,-50%)" }}
              aria-hidden
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>0 CC</span>
            <span className="flex items-center gap-1.5 font-medium text-canton">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-canton" aria-hidden />
              {LOCK_TIER_FULL} CC = Full access
            </span>
          </div>
        </div>

        {/* Term chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            Choose a lock duration:
          </span>
          {TERMS.map((term) => (
            <span
              key={term}
              className="rounded-full border border-canton-muted bg-canton-subtle px-3 py-1 text-xs font-semibold text-canton"
            >
              {term}
            </span>
          ))}
        </div>

        <p className="mt-5 flex items-start gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-canton" aria-hidden />
          <span>
            <strong className="font-medium text-[var(--foreground)]">Your CC stays yours.</strong>{" "}
            Your CC is never transferred away — it is locked in your own wallet and returned in
            full when the term ends. A small network holding fee applies while locked.
          </span>
        </p>
      </div>
    </LandingSection>
  );
}
