import {
  Gift,
  LayoutGrid,
  Sparkles,
  Ticket,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";
import { ROUTES } from "@/lib/app-routes";

const menus: {
  icon: LucideIcon;
  title: string;
  description: string;
  path: string;
}[] = [
  {
    icon: LayoutGrid,
    title: "Overview",
    description: "Points, weekly rank, CC balance, and recent activity in one dashboard.",
    path: "/overview",
  },
  {
    icon: Gift,
    title: "Quest",
    description:
      "Daily and social tasks — check-in, X follow/retweet, Telegram, quizzes. Earn points.",
    path: ROUTES.earnHub,
  },
  {
    icon: Sparkles,
    title: "Earn",
    description:
      "Partner campaigns with CC rewards, invite codes, waitlist spots, and FCFS claims.",
    path: ROUTES.campaignQuests,
  },
  {
    icon: Ticket,
    title: "Spin Reward",
    description: "Spend quest points on the wheel for CC, bonus points, and other prizes.",
    path: ROUTES.spinReward,
  },
  {
    icon: Wallet,
    title: "Wallet",
    description: "Create your Canton party, view balance, send and receive CC on-chain.",
    path: "/wallet",
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    description: "Weekly, monthly, and all-time rankings from quest and campaign points.",
    path: ROUTES.leaderboard,
  },
];

export function AppOverviewSection() {
  return (
    <section id="app" className="border-b border-[var(--border)] py-12 md:py-16">
      <LandingShell>
        <SectionHeader
          eyebrow="In the app"
          title="Everything in one place"
          description="These are the same sections you see after signing in — no extra menus or hidden pages."
          align="center"
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {menus.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.path}
                className="glass-card glass-card-hover flex flex-col rounded-2xl p-5 ring-1 ring-[var(--border)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                  <Icon className="h-5 w-5 text-canton" />
                </span>
                <h3 className="type-section-title mt-4">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {item.description}
                </p>
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {item.path}
                </p>
              </div>
            );
          })}
        </div>
      </LandingShell>
    </section>
  );
}
