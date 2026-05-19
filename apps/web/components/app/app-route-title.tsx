"use client";

import { usePathname } from "next/navigation";

const ROUTES: { prefix: string; title: string; subtitle: string }[] = [
  { prefix: "/dashboard", title: "Dashboard", subtitle: "Overview & signals" },
  { prefix: "/quests", title: "Quests", subtitle: "Campaigns & verified tasks" },
  { prefix: "/leaderboard", title: "Leaderboard", subtitle: "Rankings & tiers" },
  { prefix: "/spin", title: "Spin rewards", subtitle: "Points → prizes" },
  { prefix: "/wallet", title: "Wallet", subtitle: "Send, receive & track your balance" },
  { prefix: "/transactions", title: "Transactions", subtitle: "Activity log" },
  { prefix: "/settings", title: "Settings", subtitle: "Identity & security" },
];

export function AppRouteTitle() {
  const pathname = usePathname();
  const match =
    ROUTES.find(
      (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
    ) ?? { title: "CanQuest", subtitle: "Application" };

  return (
    <div>
      <h1 className="font-[family-name:var(--font-space)] text-lg font-semibold tracking-tight md:text-xl">
        {match.title}
      </h1>
      <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
        {match.subtitle}
      </p>
    </div>
  );
}
