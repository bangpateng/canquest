import {
  Gift,
  LayoutGrid,
  Settings,
  Sparkles,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { DocsMobileNav, DocsSidebar } from "@/components/docs/docs-sidebar";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { ROUTES } from "@/lib/routing/app-routes";
import { cn } from "@/lib/utils/utils";

type MenuItem = {
  icon: LucideIcon;
  title: string;
  path: string;
  summary: string;
  details: string[];
  note?: string;
};

const APP_MENUS: MenuItem[] = [
  {
    icon: LayoutGrid,
    title: "Overview",
    path: "/overview",
    summary: "Your home dashboard after sign-in.",
    details: [
      "See your CC balance and total quest points at a glance.",
      "Track weekly rank and recent activity.",
      "Jump quickly to Earn campaigns or Quest tasks.",
    ],
  },
  {
    icon: Sparkles,
    title: "Earn",
    path: ROUTES.campaignQuests,
    summary: "Partner campaigns with CC, invite codes, and early-access rewards.",
    details: [
      "Browse live partner missions and open a campaign to see its tasks.",
      "Complete required steps (social follows, quizzes, forms, and more).",
      "Claim CC payouts, invite codes, or access codes for Canton ecosystem projects.",
      "Get waitlist spots, raffle entries, or FCFS slots — arrive before the wider public.",
    ],
    note: "Requires a Canton wallet before you can participate.",
  },
  {
    icon: Gift,
    title: "Quests",
    path: ROUTES.earnHub,
    summary: "CanQuest daily hub — earn points from recurring tasks.",
    details: [
      "Daily check-in with streak milestones for bonus points.",
      "Social tasks (Twitter, Telegram, Discord) and quizzes.",
      "Redeem earned points for CC, invite codes, access codes, or other catalog rewards.",
      "Invite friends with your referral link to earn points per verified signup.",
    ],
    note: "Requires a Canton wallet to submit tasks and redeem rewards.",
  },
  {
    icon: Wallet,
    title: "Wallet",
    path: "/wallet",
    summary: "Your Canton party ID and on-chain CC balance.",
    details: [
      "Create a wallet with a team invite code (daily creation quota applies).",
      "View your party ID, balance, and transaction history.",
      "Send and receive CC to other users.",
      "Enable CIP-56 preapproval for faster campaign claims.",
    ],
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    path: ROUTES.leaderboard,
    summary: "See how you rank against other players.",
    details: [
      "Compare weekly, monthly, and all-time standings.",
      "Rankings are based on quest activity and points earned on the platform.",
    ],
  },
  {
    icon: Settings,
    title: "Settings",
    path: "/setting",
    summary: "Manage your account and connected services.",
    details: [
      "View account details and connect or disconnect Twitter.",
      "Copy your referral invite link.",
      "Sign out when you are done.",
    ],
  },
];

const LANDING_SECTIONS = [
  {
    anchor: "#campaigns",
    title: "Earn (campaigns)",
    description: "Preview featured partner campaigns before you sign in.",
  },
  {
    anchor: "#app",
    title: "App",
    description: "Summary of every menu available inside the platform.",
  },
  {
    anchor: "#canton",
    title: "Wallet / Canton",
    description: "How CC rewards land in your on-chain Canton wallet.",
  },
] as const;

function DocsSection({
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
    <section id={id} className={cn("scroll-mt-24 border-b border-[var(--border)] py-10 last:border-b-0 md:py-12", className)}>
      <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </div>
    </section>
  );
}

function DocsSubsection({
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

export function DocsPageContent() {
  return (
    <div className="border-b border-[var(--border)]">
      <LandingShell className="py-10 pb-16 md:py-12">
        <div className="flex items-start gap-8 xl:gap-12">
          <DocsSidebar />

          <div className="min-w-0 flex-1">
            <header className="mb-8 max-w-2xl">
              <p className="type-eyebrow-brand">Documentation</p>
              <h1 className="type-display mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                CanQuest user guide
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
                Everything you need to know about the website menus, sign-in flow, and what you can
                do on CanQuest.
              </p>
            </header>

            <DocsMobileNav />
        <DocsSection id="introduction" title="Introduction">
          <p>
            <strong className="font-medium text-[var(--foreground)]">CanQuest</strong> is a quest
            platform on the{" "}
            <strong className="font-medium text-[var(--foreground)]">Canton network</strong>. You
            complete missions from partners and daily CanQuest tasks, earn points, climb the
            leaderboard, and claim rewards — not only{" "}
            <strong className="font-medium text-[var(--foreground)]">CC (Canton Coin)</strong>, but
            also <strong className="font-medium text-[var(--foreground)]">invite codes</strong> and{" "}
            <strong className="font-medium text-[var(--foreground)]">access codes</strong> for
            projects in the Canton ecosystem, so you can get in earlier than the public launch.
          </p>
          <p>The platform combines three things in one account:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-[var(--foreground)]">Earn</strong> — partner
              campaigns with CC, invite/access codes, lottery, or first-come-first-served rewards.
            </li>
            <li>
              <strong className="font-medium text-[var(--foreground)]">Quests</strong> — recurring
              daily and social tasks that give you redeemable points.
            </li>
            <li>
              <strong className="font-medium text-[var(--foreground)]">Wallet</strong> — a Canton
              party ID that holds your on-chain CC balance.
            </li>
          </ul>
          <p>
            Visit the{" "}
            <Link href="/" className="text-canton underline-offset-2 hover:underline">
              landing page
            </Link>{" "}
            to browse campaigns, or launch the app to sign in and start earning.
          </p>
        </DocsSection>

        <DocsSection id="getting-started" title="Getting started">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong className="font-medium text-[var(--foreground)]">Create an account</strong> —
              click <em>Launch App</em> on the landing page or header, then register with email and
              password. Verify your email with the OTP code sent to your inbox. You can optionally
              enter a friend&apos;s referral code during sign-up.
            </li>
            <li>
              <strong className="font-medium text-[var(--foreground)]">Open the platform</strong> —
              after sign-in you land on{" "}
              <Link href="/overview" className="text-canton underline-offset-2 hover:underline">
                Overview
              </Link>
              . The sidebar (desktop) or bottom bar (mobile) lists all app menus.
            </li>
            <li>
              <strong className="font-medium text-[var(--foreground)]">Create your wallet</strong> —
              go to{" "}
              <Link href="/wallet" className="text-canton underline-offset-2 hover:underline">
                Wallet
              </Link>{" "}
              and enter a team invite code to create your Canton wallet. Earn
              requires a wallet; Quest task submission and redemption do as well.
            </li>
            <li>
              <strong className="font-medium text-[var(--foreground)]">Start earning</strong> —
              pick a partner campaign under Earn or complete daily tasks under Quests, then claim
              your rewards.
            </li>
          </ol>
          <div className="pt-2">
            <LaunchAppButton size="lg" className="rounded-full" />
          </div>
        </DocsSection>

        <DocsSection id="landing-page" title="Landing page menus">
          <p>
            The public site at{" "}
            <Link href="/" className="text-canton underline-offset-2 hover:underline">
              canquest.cc
            </Link>{" "}
            does not require sign-in. The header links scroll to sections on the same page:
          </p>
          <ul className="space-y-3">
            {LANDING_SECTIONS.map((section) => (
              <li
                key={section.anchor}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3"
              >
                <p className="font-medium text-[var(--foreground)]">{section.title}</p>
                <p className="mt-1">{section.description}</p>
                <p className="mt-1 text-xs">
                  Anchor:{" "}
                  <Link href={`/${section.anchor}`} className="text-canton hover:underline">
                    {section.anchor}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          <p>
            The header also has <em>Launch App</em>, which opens sign-in or takes you to Overview if
            you are already logged in.
          </p>
        </DocsSection>

        <DocsSection id="app-menus" title="App menus (after sign-in)">
          <p>
            Once signed in, these menus are available in the platform sidebar and mobile navigation:
          </p>
          <ul className="space-y-4">
            {APP_MENUS.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.path}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canton-subtle">
                      <Icon className="h-4 w-4 text-canton" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h3 className="text-sm font-semibold text-[var(--foreground)]">
                          {item.title}
                        </h3>
                        <Link
                          href={item.path}
                          className="text-xs text-canton underline-offset-2 hover:underline"
                        >
                          {item.path}
                        </Link>
                      </div>
                      <p className="mt-1">{item.summary}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {item.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                      {item.note ? (
                        <p className="mt-2 text-xs text-orange-200/90">{item.note}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p>
            The platform header also includes theme toggle (light/dark), language picker, and
            notifications for rewards such as CC received from Earn or quests.
          </p>
        </DocsSection>

        <DocsSection id="what-you-can-do" title="What you can do on CanQuest" className="border-b-0">
          <div className="space-y-8">
            <DocsSubsection id="reward-types" title="Reward types">
              <p>
                Prizes are not limited to CC. Depending on the campaign or redeem catalog, you may
                receive:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong className="font-medium text-[var(--foreground)]">CC (Canton Coin)</strong>{" "}
                  — sent to your on-chain wallet.
                </li>
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Invite codes</strong> —
                  early entry to a partner app, testnet, or community.
                </li>
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Access codes</strong> —
                  unlock beta, whitelist, or ecosystem project perks on Canton before general release.
                </li>
                <li>Lottery entries, waitlist slots, and first-come-first-served claims.</li>
              </ul>
              <p>
                Finishing quests early helps you secure codes and spots while supply lasts — so you
                can show up ahead of the crowd.
              </p>
            </DocsSubsection>

            <DocsSubsection id="partner-campaigns" title="Partner campaigns (Earn)">
              <ul className="list-disc space-y-1 pl-5">
                <li>Browse live and completed partner missions.</li>
                <li>
                  Open a campaign to read rules, tasks, and reward type (CC, invite/access code,
                  lottery, FCFS).
                </li>
                <li>Complete all required tasks, then claim your reward when eligible.</li>
                <li>CC goes to your Canton wallet; codes are shown in-app for you to copy and use.</li>
              </ul>
            </DocsSubsection>

            <DocsSubsection id="daily-hub" title="Daily hub (Quests)">
              <ul className="list-disc space-y-1 pl-5">
                <li>Check in daily and build a streak for milestone bonus points.</li>
                <li>Complete verified social tasks (follow, retweet, join channels).</li>
                <li>Answer quiz tasks for points.</li>
                <li>
                  Redeem accumulated points for CC, invite codes, access codes, or other rewards.
                </li>
                <li>Share your referral link — earn points when friends verify their account.</li>
              </ul>
            </DocsSubsection>

            <DocsSubsection id="wallet-cc" title="Wallet & CC">
              <ul className="list-disc space-y-1 pl-5">
                <li>Hold CC from campaign claims and quest redemptions.</li>
                <li>View balance and transaction history in one place.</li>
                <li>Send CC to other users when you are ready.</li>
              </ul>
            </DocsSubsection>

            <DocsSubsection id="compete-customize" title="Compete & customize">
              <ul className="list-disc space-y-1 pl-5">
                <li>Check your rank on the Leaderboard (weekly, monthly, all-time).</li>
                <li>Connect Twitter in Settings for tasks that require it.</li>
                <li>Switch UI language and color theme from the platform toolbar.</li>
              </ul>
            </DocsSubsection>
          </div>

          <p className="pt-6 text-xs">
            Questions or partnership inquiries? Reach us through the social links in the site footer.
          </p>
        </DocsSection>
          </div>
        </div>
      </LandingShell>
    </div>
  );
}
