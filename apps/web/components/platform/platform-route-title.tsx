"use client";

import { ROUTES as APP_ROUTES } from "@/lib/app-routes";
import { ToolbarTitle, Lead } from "@/components/ui/typography";
import { usePathname } from "next/navigation";

const ROUTES: { prefix: string; title: string; subtitle: string }[] = [
  { prefix: "/overview", title: "Overview", subtitle: "Profile, rank & activity" },
  { prefix: APP_ROUTES.campaignQuests, title: "Earn", subtitle: "Partner campaigns & missions" },
  { prefix: APP_ROUTES.earnHub, title: "Quest", subtitle: "Daily tasks & redeem" },
  { prefix: "/spin-daily", title: "Daily Spin", subtitle: "Gamified rewards wheel" },
  { prefix: "/wallet", title: "Wallet", subtitle: "Send, receive & balance" },
  { prefix: APP_ROUTES.leaderboard, title: "Leaderboard", subtitle: "Weekly, monthly & all-time" },
  { prefix: "/setting", title: "Settings", subtitle: "Profile & preferences" },
];

export function PlatformRouteTitle() {
  const pathname = usePathname();
  const match =
    ROUTES.find(
      (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
    ) ?? { title: "CanQuest", subtitle: "Platform" };

  return (
    <div>
      <ToolbarTitle>{match.title}</ToolbarTitle>
      <Lead className="mt-0.5 hidden md:block">{match.subtitle}</Lead>
    </div>
  );
}
