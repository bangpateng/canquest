import {
  Activity,
  Gift,
  LayoutGrid,
  Sparkles,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/** Mirrors the real (platform) routes. Wallet bundles send-cc/send-token/swap/lock. */
const menus: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: LayoutGrid, title: "Overview", description: "Profile, leaderboard, locked & unlocked CC, quest & earn counts, on-chain tx" },
  { icon: Sparkles, title: "Earn", description: "Partner campaigns to get early access" },
  { icon: Gift, title: "Quests", description: "Daily check-in & other tasks to collect points" },
  { icon: Wallet, title: "Wallet", description: "Send CC & USDCx, swap, lock" },
  { icon: Trophy, title: "Leaderboard", description: "Rank among verified users" },
  { icon: Activity, title: "Activity", description: "Transaction history" },
];

export function AppOverviewSection() {
  return (
    <LandingSection id="app">
      <SectionHeader eyebrow="App" title="What's inside" align="center" className="mb-10 md:mb-12" />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {menus.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title}>
              <article className="glass-card glass-card-hover group flex h-full items-start gap-4 rounded-2xl p-5 ring-1 ring-[var(--border)]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15 transition-transform group-hover:scale-105">
                  <Icon className="h-5 w-5 text-canton" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    {item.title}
                  </h3>
                  <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                    {item.description}
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </LandingSection>
  );
}
