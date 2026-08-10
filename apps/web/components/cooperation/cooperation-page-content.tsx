import {
  ArrowLeftRight,
  CalendarDays,
  Rocket,
  Sparkles,
  Trophy,
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
      "Your quest lives under the Earn menu. Users do tasks, get verified, and claim their reward.",
  },
  {
    icon: CalendarDays,
    title: "Events & launches",
    description:
      "A time-limited push around a mainnet launch, AMA, or testnet wave.",
  },
  {
    icon: ArrowLeftRight,
    title: "Swap built in",
    description:
      "CC you hand out is usable right away — users can swap it for USDCx in the app.",
  },
  {
    icon: Trophy,
    title: "Leaderboard visibility",
    description:
      "Active campaigns show up on weekly, monthly, and all-time leaderboards.",
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
                Work with CanQuest
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
                Run a campaign on CanQuest and put your project in front of real
                Canton users — people who lock CC and complete tasks to
                participate, not bots.
              </p>
            </header>

            <CooperationMobileNav />

            <CooperationSection id="overview" title="Overview">
              <p>
                CanQuest is a quest platform on the Canton Network. Users do
                tasks, earn points and CC, and join partner campaigns. We feature
                yours under the <strong className="font-medium text-[var(--foreground)]">Earn</strong>{" "}
                menu and help you set it up — whether it&apos;s a product launch,
                a testnet push, or just getting more eyes on your project.
              </p>
            </CooperationSection>

            <CooperationSection id="who-its-for" title="Who it's for">
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  "Apps and protocols in the Canton ecosystem",
                  "Wallets, infrastructure, and tooling projects",
                  "Communities running AMAs or growth pushes",
                  "Projects handing out invite or access codes",
                  "Anyone rewarding users with CC for real actions",
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
                    A standard quest under{" "}
                    <Link href="/earn" className="text-canton underline-offset-2 hover:underline">
                      Earn
                    </Link>
                    . Users see your banner, do the tasks, and claim their reward.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Your banner, logo, and campaign text</li>
                    <li>Custom task list with verification</li>
                    <li>Winner draws and a results report for raffles</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="events-launches" title="Events & launches">
                  <p>A time-limited campaign tied to a launch or milestone.</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Set start and end dates with live status in the app</li>
                    <li>Featured on the landing page and in Earn</li>
                    <li>Optional co-marketing on our social channels (by agreement)</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="reward-formats" title="Reward formats">
                  <p>You can reward users with:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">CC</strong>{" "}
                      — sent to the user&apos;s wallet, swappable for USDCx in-app
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">Invite or access codes</strong>{" "}
                      — early access, whitelist, or beta perks
                    </li>
                    <li>Raffle entries, waitlist slots, and first-come-first-served claims</li>
                  </ul>
                  <p>
                    Joining can be free, require a CC lock, or cost points — your
                    choice.
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
                    body: "Fill in the form below with your project, timeline, and what you have in mind.",
                  },
                  {
                    step: "2",
                    title: "We plan it together",
                    body: "Tasks, reward type, and how long it runs.",
                  },
                  {
                    step: "3",
                    title: "You send the assets",
                    body: "Logo, copy, links, and the rewards (CC, codes, etc.).",
                  },
                  {
                    step: "4",
                    title: "We launch it",
                    body: "We set it up and publish under Earn. Users start participating.",
                  },
                  {
                    step: "5",
                    title: "See how it went",
                    body: "We send you the numbers — participation, claims, winners.",
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

            <CooperationSection id="partner-form" title="Partner with us" className="border-b-0">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
                <div className="mb-6 flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canton-subtle">
                    <Rocket className="h-5 w-5 text-canton" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      Tell us about your project
                    </p>
                    <p className="mt-2">
                      Fill in the form and we&apos;ll get back to you within a couple
                      of business days. It helps to have your links, campaign goal,
                      reward type, and timeline ready.
                    </p>
                  </div>
                </div>

                <ContactForm />
              </div>
            </CooperationSection>
          </div>
        </div>
      </LandingShell>
    </div>
  );
}
