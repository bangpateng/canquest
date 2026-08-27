"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Gift,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";

const ACTIONS = [
  {
    href: "/wallet",
    icon: ArrowUpRight,
    label: "Send",
    desc: "Transfer CC or tokens",
    accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20",
    iconColor: "text-emerald-600",
  },
  {
    href: "/wallet",
    icon: ArrowLeftRight,
    label: "Swap",
    desc: "CC ↔ USDCx via OneSwap",
    accent: "from-violet-500/10 to-violet-500/5 border-violet-500/20",
    iconColor: "text-violet-600",
  },
  {
    href: "/wallet",
    icon: Lock,
    label: "Lock CC",
    desc: "Unlock campaign access",
    accent: "from-amber-500/10 to-amber-500/5 border-amber-500/20",
    iconColor: "text-amber-600",
  },
  {
    href: "/quests",
    icon: Gift,
    label: "Quests",
    desc: "Daily tasks & rewards",
    accent: "from-canton/10 to-canton/5 border-canton/20",
    iconColor: "text-canton",
  },
] as const;

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {ACTIONS.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className={cn(
            "group flex flex-col gap-2 rounded-2xl border bg-gradient-to-br p-4 transition-all duration-200",
            "hover:-translate-y-0.5 hover:shadow-lg sm:p-5",
            action.accent,
          )}
        >
          <div className="flex items-center justify-between">
            <action.icon
              className={cn("h-6 w-6 transition-transform group-hover:scale-110", action.iconColor)}
              aria-hidden
            />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--foreground)]">
              {action.label}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {action.desc}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
