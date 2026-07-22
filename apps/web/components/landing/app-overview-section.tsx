import {
  Gift,
  LayoutGrid,
  Settings,
  Sparkles,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

const menus: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: LayoutGrid, title: "Overview", description: "Dashboard, balance & activity" },
  { icon: Sparkles, title: "Earn", description: "Early access to partner projects" },
  { icon: Gift, title: "Quests", description: "Daily verified tasks" },
  { icon: Wallet, title: "Wallet", description: "Send, swap & lock CC" },
  { icon: Trophy, title: "Leaderboard", description: "Rank among real users" },
  { icon: Settings, title: "Settings", description: "Account & referral link" },
];

export function AppOverviewSection() {
  return (
    <LandingSection id="app">
      <SectionHeader
        eyebrow="App"
        title="Everything in one verified account"
        align="center"
        className="mb-8 md:mb-10"
      />

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {menus.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title}>
              <article className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canton-subtle">
                  <Icon className="h-4 w-4 text-canton" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">{item.title}</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{item.description}</p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </LandingSection>
  );
}
