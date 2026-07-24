import {
  ArrowLeftRight,
  CalendarDays,
  Gift,
  Rocket,
  Sparkles,
  Ticket,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContactForm } from "@/components/cooperation/contact-form";
import {
  CooperationMobileNav,
  CooperationSidebar,
} from "@/components/cooperation/cooperation-sidebar";
import { LandingShell } from "@/components/landing/landing-shell";
import { cn } from "@/lib/utils/utils";

const OFFERINGS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Sparkles,
    title: "Earn campaigns",
    description:
      "Featured partner quests on CanQuest with tasks, verification, and reward delivery built in.",
  },
  {
    icon: CalendarDays,
    title: "Events & launches",
    description:
      "Time-boxed activations for mainnet launches, AMAs, testnet waves, and ecosystem milestones.",
  },
  {
    icon: Gift,
    title: "Flexible rewards",
    description:
      "CC payouts, invite codes, access codes, waitlist slots, raffles, and FCFS claims — configured per campaign.",
  },
  {
    icon: ArrowLeftRight,
    title: "Built-in on-chain swap",
    description:
      "CC you distribute is immediately usable — users can swap it for tokens like USDCx through the OneSwap exchange without leaving CanQuest.",
  },
  {
    icon: Trophy,
    title: "Leaderboard reach",
    description:
      "Your campaign activity feeds the weekly, monthly, and all-time leaderboards — giving top participants extra visibility and a reason to engage deeper.",
  },
  {
    icon: Users,
    title: "High-intent, committed audience",
    description:
      "Reach users who have locked CC on-chain or spent earned points to reach Full access — real participants who put skin in the game, not free-riders or bots.",
  },
];

function CooperationSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 border-b border-[var(--border)] py-10 last:border-b-0 md:py-12",
        className,
      )}
    >
      <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </div>
    </section>
  );
}

function CooperationSubsection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <h3 className="font-semibold text-[var(--foreground)]">{title}</h3>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

export function CooperationPageContent() {
  return (
    <div className="border-b border-[var(--border)]">
      <LandingShell className="py-10 pb-16 md:py-12">
        <div className="flex items-start gap-8 xl:gap-12">
          <CooperationSidebar />

          <div className="min-w-0 flex-1">
            <header className="mb-8 max-w-2xl">
              <p className="type-eyebrow-brand">Partnerships</p>
              <h1 className="type-display mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                Cooperate with CanQuest
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
                Launch campaigns and events in front of a community of verified,
                sybil-resistant users. Your rewards reach real participants — not farms of
                fake accounts — and grow your project with quest-based activations.
              </p>
            </header>

            <CooperationMobileNav />

            <CooperationSection id="overview" title="Overview">
              <p>
                <strong className="font-medium text-[var(--foreground)]">CanQuest</strong> helps
                projects in the{" "}
                <strong className="font-medium text-[var(--foreground)]">Canton ecosystem</strong>{" "}
                run partner missions and community events from one platform. Users complete tasks,
                claim rewards, and stay engaged — while you get visibility, verified participation,
                and measurable outcomes.
              </p>
              <p>
                Whether you are preparing a product launch, growing a testnet, or running a
                limited-time community event, we can host your activation under the{" "}
                <strong className="font-medium text-[var(--foreground)]">Earn</strong> menu and
                promote it to our user base.
              </p>
            </CooperationSection>

            <CooperationSection id="who-its-for" title="Who it's for">
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  "Canton ecosystem apps and protocols",
                  "Wallets, infra, and tooling partners",
                  "Communities planning AMAs, campaigns, or growth sprints",
                  "Projects distributing invite or access codes before public launch",
                  "Teams rewarding users with CC for qualified actions",
                ].map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[var(--foreground)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </CooperationSection>

            <CooperationSection id="what-we-offer" title="What we offer">
              <ul className="grid gap-3 sm:grid-cols-2">
                {OFFERINGS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.title}
                      className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canton-subtle">
                        <Icon className="h-4 w-4 text-canton" aria-hidden />
                      </span>
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">{item.title}</p>
                        <p className="mt-1">{item.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CooperationSection>

            <CooperationSection id="collaboration-types" title="Collaboration types">
              <div className="space-y-8">
                <CooperationSubsection id="earn-campaigns" title="Earn campaigns">
                  <p>
                    A standard partner quest listed under{" "}
                    <Link href="/earn" className="text-canton underline-offset-2 hover:underline">
                      Earn
                    </Link>
                    . Users discover your banner, complete tasks (social, quiz, forms, and more),
                    and claim rewards when eligible.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Custom banner, logo, and campaign copy</li>
                    <li>Task list with verification rules</li>
                    <li>Reward pool management (CC, codes, lottery, FCFS)</li>
                    <li>Winner draws and reporting for raffle-style campaigns</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="events-launches" title="Events & launches">
                  <p>
                    Short or multi-day activations tied to a launch window — ideal for coordinated
                    community push around a milestone.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Scheduled start and end dates with live status on the platform</li>
                    <li>Featured placement on the landing page and Earn hub</li>
                    <li>AMA, testnet, or mainnet-themed task packs</li>
                    <li>Co-marketing via CanQuest social channels (by agreement)</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="reward-formats" title="Reward formats">
                  <p>We support multiple reward types so your campaign matches your goals:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">CC (Canton Coin)</strong>{" "}
                      — on-chain delivery to the user&apos;s Canton wallet, swappable for USDCx in-app
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">Invite codes</strong>{" "}
                      — early access to your app, testnet, or community
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">Access codes</strong>{" "}
                      — whitelist, beta, or ecosystem perks before public release
                    </li>
                    <li>Lottery entries, waitlist slots, and first-come-first-served claims</li>
                  </ul>
                  <p>
                    Joining a campaign can be free, require a CC lock, or cost earned points — you
                    choose the signal strength per event.
                  </p>
                </CooperationSubsection>
              </div>
            </CooperationSection>

            <CooperationSection id="how-it-works" title="How it works">
              <ol className="space-y-4">
                {[
                  {
                    step: "1",
                    title: "Reach out",
                    body: "Tell us about your project, timeline, target audience, and reward budget.",
                  },
                  {
                    step: "2",
                    title: "Scope the campaign",
                    body: "We align on tasks, reward type, duration, and any event-specific requirements.",
                  },
                  {
                    step: "3",
                    title: "Prepare assets",
                    body: "You provide branding, copy, links, and reward inventory (CC, codes, etc.).",
                  },
                  {
                    step: "4",
                    title: "Launch on CanQuest",
                    body: "We configure and publish your campaign; users participate through Earn.",
                  },
                  {
                    step: "5",
                    title: "Review results",
                    body: "Track participation, claims, and winners — iterate for future activations.",
                  },
                ].map((item) => (
                  <li key={item.step} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canton-subtle text-sm font-bold text-canton">
                      {item.step}
                    </span>
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{item.title}</p>
                      <p className="mt-1">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CooperationSection>

            <CooperationSection id="what-we-need" title="What we need from you">
              <p>To move quickly, please prepare the following when you contact us:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Project name, one-line description, and official links (site, X, Telegram, Discord)</li>
                <li>Campaign goal (growth, launch, education, code distribution, etc.)</li>
                <li>Proposed tasks and verification method (social, quiz, on-chain, etc.)</li>
                <li>Reward type and estimated pool size</li>
                <li>Banner / logo assets (recommended sizes will be shared on request)</li>
                <li>Preferred start date, duration, and any hard deadlines</li>
              </ul>
            </CooperationSection>

            <CooperationSection id="partner-form" title="Partner with us" className="border-b-0">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
                <div className="mb-6 flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canton-subtle">
                    <Rocket className="h-5 w-5 text-canton" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      Work with CanQuest
                    </p>
                    <p className="mt-2">
                      Fill in the form below and our team will get back to you. Submissions
                      land directly in our inbox — we typically reply within a few business
                      days.
                    </p>
                  </div>
                </div>

                <ContactForm />
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Ticket, label: "Quest-based UX", text: "Familiar flow users already know" },
                  { icon: Sparkles, label: "Earn placement", text: "Visible in app and on landing" },
                  { icon: Gift, label: "Multi-reward", text: "CC, codes, and access in one place" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)]/60 px-4 py-3 text-center"
                    >
                      <Icon className="mx-auto h-4 w-4 text-canton" aria-hidden />
                      <p className="mt-2 text-xs font-semibold text-[var(--foreground)]">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-xs">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </CooperationSection>
          </div>
        </div>
      </LandingShell>
    </div>
  );
}
