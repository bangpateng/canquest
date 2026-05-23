"use client";

import { ROUTES as APP_ROUTES } from "@/lib/app-routes";
import { ToolbarTitle, Lead } from "@/components/ui/typography";
import { usePathname } from "next/navigation";

const ROUTES: { prefix: string; title: string; subtitle: string }[] = [
  { prefix: "/dashboard", title: "Dashboard", subtitle: "Overview & signals" },
  { prefix: APP_ROUTES.campaignQuests, title: "Earn", subtitle: "Partner campaigns & missions" },
  { prefix: APP_ROUTES.earnHub, title: "Quest", subtitle: "Daily tasks & redeem" },
  { prefix: "/quests", title: "Quest", subtitle: "Partner campaigns & missions" },
  { prefix: "/leaderboard", title: "Leaderboard", subtitle: "Rankings & tiers" },
  { prefix: "/spin", title: "Spin rewards", subtitle: "Points → prizes" },
  { prefix: "/wallet", title: "Wallet", subtitle: "Send, receive & balance" },
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
      <ToolbarTitle>{match.title}</ToolbarTitle>
      <Lead className="mt-0.5 hidden sm:block">{match.subtitle}</Lead>
    </div>
  );
}
