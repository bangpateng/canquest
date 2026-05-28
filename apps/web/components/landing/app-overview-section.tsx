import {
  Gift,
  LayoutGrid,
  Sparkles,
  Ticket,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LandingReveal } from "@/components/landing/landing-reveal";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

const menus: {
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
}[] = [
  {
    icon: LayoutGrid,
    title: "Overview",
    description: "Rank, balance, and a timeline of what you did this week.",
    className: "sm:col-span-2 lg:col-span-1",
  },
  {
    icon: Gift,
    title: "Quest",
    description: "Check-ins, quizzes, and social actions in the shared hub.",
  },
  {
    icon: Sparkles,
    title: "Earn",
    description: "Time-boxed partner events with their own art and rules.",
    className: "sm:col-span-2",
  },
  {
    icon: Ticket,
    title: "Spin Reward",
    description: "Trade hub points on the wheel for variable prizes.",
  },
  {
    icon: Wallet,
    title: "Wallet",
    description: "Party ID, balance, send flow, and preapproval status.",
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    description: "Weekly, monthly, and all-time standings.",
  },
];

export function AppOverviewSection() {
  return (
    <LandingSection id="app">
      <LandingReveal>
      <SectionHeader
        eyebrow="Product"
        title="Six tabs, one account"
        description="After login you land on Overview — everything else is a click away in the sidebar."
        align="center"
      />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {menus.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className={item.className}>
              <article className="glass-card glass-card-hover group relative flex h-full flex-col overflow-hidden rounded-2xl p-5 ring-1 ring-[var(--border)] sm:p-6">
                <span
                  className="pointer-events-none absolute -right-2 -top-3 select-none text-5xl font-bold tabular-nums text-[var(--foreground)]/[0.04] transition-colors group-hover:text-canton/[0.08]"
                  aria-hidden
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
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
      </LandingReveal>
    </LandingSection>
  );
}
