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
      "We host your quest under the Earn menu. Users do tasks, get verified, and claim their reward — all in one place.",
  },
  {
    icon: CalendarDays,
    title: "Events & launches",
    description:
      "Got a mainnet launch, AMA, or testnet wave coming up? We can run a time-limited campaign around it.",
  },
  {
    icon: Gift,
    title: "Flexible rewards",
    description:
      "Pay in CC, invite codes, access codes, waitlist slots, or raffle entries. You pick what works for your campaign.",
  },
  {
    icon: ArrowLeftRight,
    title: "Swap built in",
    description:
      "CC you hand out is usable right away — users can swap it for USDCx inside the app, no extra steps.",
  },
  {
    icon: Trophy,
    title: "Leaderboard reach",
    description:
      "Active campaigns show up across weekly, monthly, and all-time leaderboards, so your project stays visible.",
  },
  {
    icon: Users,
    title: "Real users, not bots",
    description:
      "Our users verify their identity and lock CC or earn points to participate. You reach people who actually show up.",
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
                Want to reach real Canton users? Run a campaign on CanQuest and put
                your project in front of people who are actually paying attention —
                not bots or airdrop hunters.
              </p>
            </header>

            <CooperationMobileNav />

            <CooperationSection id="overview" title="Overview">
              <p>
                <strong className="font-medium text-[var(--foreground)]">CanQuest</strong> is a
                quest platform on the{" "}
                <strong className="font-medium text-[var(--foreground)]">Canton Network</strong>.
                Users do tasks, earn points and CC, and join partner campaigns. If you have a
                project to promote, we can feature it under the{" "}
                <strong className="font-medium text-[var(--foreground)]">Earn</strong> menu and
                help you reach our community.
              </p>
              <p>
                Whether it&apos;s a product launch, a testnet push, or just getting more eyes on
                your project, we&apos;ll help you set it up and run it.
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
                    A standard quest listed under{" "}
                    <Link href="/earn" className="text-canton underline-offset-2 hover:underline">
                      Earn
                    </Link>
                    . Users see your banner, do the tasks (social, quiz, or whatever you set up),
                    and claim their reward when done.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Your banner, logo, and campaign text</li>
                    <li>Custom task list with verification</li>
                    <li>Reward pool (CC, codes, raffle, or first-come-first-served)</li>
                    <li>Winner draws and a results report for raffle campaigns</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="events-launches" title="Events & launches">
                  <p>
                    A short, time-limited campaign tied to a launch or milestone — good for a
                    focused community push.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Set start and end dates, with a live status shown in the app</li>
                    <li>Featured on the landing page and in the Earn hub</li>
                    <li>Task packs themed around an AMA, testnet, or mainnet launch</li>
                    <li>Optional co-marketing on our social channels (by agreement)</li>
                  </ul>
                </CooperationSubsection>

                <CooperationSubsection id="reward-formats" title="Reward formats">
                  <p>You can reward users in a few different ways:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">CC (Canton Coin)</strong>{" "}
                      — sent straight to the user&apos;s wallet, swappable for USDCx in the app
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">Invite codes</strong>{" "}
                      — early access to your app, testnet, or community
                    </li>
                    <li>
                      <strong className="font-medium text-[var(--foreground)]">Access codes</strong>{" "}
                      — whitelist, beta, or other perks before public release
                    </li>
                    <li>Raffle entries, waitlist slots, and first-come-first-served claims</li>
                  </ul>
                  <p>
                    Joining a campaign can be free, require a CC lock, or cost points — it&apos;s
                    up to you.
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
                    body: "Fill in the form below. Tell us about your project, timeline, and what you have in mind.",
                  },
                  {
                    step: "2",
                    title: "We plan it together",
                    body: "We figure out the tasks, reward type, and how long it should run.",
                  },
                  {
                    step: "3",
                    title: "You send the assets",
                    body: "Logo, copy, links, and the rewards themselves (CC, codes, etc.).",
                  },
                  {
                    step: "4",
                    title: "We launch it",
                    body: "We set everything up and publish your campaign under Earn. Users start participating.",
                  },
                  {
                    step: "5",
                    title: "See how it went",
                    body: "Once it wraps up, we send you the numbers — participation, claims, winners.",
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
              <p>To keep things moving, it helps to have these ready when you reach out:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Project name, a short description, and your links (site, X, Telegram, Discord)</li>
                <li>What you want out of the campaign (growth, launch, awareness, distributing codes, etc.)</li>
                <li>The kind of tasks you have in mind (social, quiz, on-chain, etc.)</li>
                <li>Reward type and roughly how big the pool is</li>
                <li>Logo and banner assets (we&apos;ll share recommended sizes when needed)</li>
                <li>When you&apos;d like to start, how long it should run, and any deadlines</li>
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
                      Tell us about your project
                    </p>
                    <p className="mt-2">
                      Fill in the form and we&apos;ll get back to you. We usually reply within a
                      couple of business days.
                    </p>
                  </div>
                </div>

                <ContactForm />
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Ticket, label: "Easy for users", text: "A flow they already know" },
                  { icon: Sparkles, label: "In the app", text: "Visible in Earn and on the landing page" },
                  { icon: Gift, label: "Any reward", text: "CC, codes, or access — your call" },
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
