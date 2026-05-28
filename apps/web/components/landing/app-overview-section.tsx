import {
  Gift,
  LayoutGrid,
  Sparkles,
  Ticket,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";
import { ROUTES } from "@/lib/app-routes";

const menus: {
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    icon: LayoutGrid,
    title: "Overview",
    description: "Points, weekly rank, CC balance, and recent activity in one dashboard.",
  },
  {
    icon: Gift,
    title: "Quest",
    description:
      "Daily and social tasks — check-in, X, Telegram, quizzes. Earn points in the hub.",
  },
  {
    icon: Sparkles,
    title: "Earn",
    description:
      "Partner campaigns with branding, CC rewards, FCFS claims, and invite codes.",
  },
  {
    icon: Ticket,
    title: "Spin Reward",
    description: "Spend quest points on the wheel for CC, bonus points, and other prizes.",
  },
  {
    icon: Wallet,
    title: "Wallet",
    description: "Create your Canton party, view balance, send and receive CC on-chain.",
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    description: "Weekly, monthly, and all-time rankings from quest and campaign points.",
  },
];

export function AppOverviewSection() {
  return (
    <LandingSection id="app">
      <SectionHeader
        eyebrow="In the app"
        title="Everything in one place"
        description="The same sections you see after signing in — no hidden pages or extra installs."
        align="center"
      />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {menus.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title}>
              <article className="glass-card glass-card-hover flex h-full flex-col rounded-2xl p-5 ring-1 ring-[var(--border)] sm:p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                  <Icon className="h-5 w-5 text-canton" aria-hidden />
                </span>
                <h3 className="type-section-title mt-4">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {item.description}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </LandingSection>
  );
}
