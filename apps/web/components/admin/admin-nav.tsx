"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gift, KeyRound, LayoutGrid, Scroll, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils/utils";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact: boolean;
}[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutGrid, exact: true },
  { href: "/admin/earn", label: "Earn campaigns", icon: Scroll, exact: false },
  { href: "/admin/quests", label: "Quest hub", icon: Gift, exact: false },
  { href: "/admin/users", label: "Users", icon: Users, exact: false },
  { href: "/admin/wallet-invites", label: "Generate wallet codes", icon: KeyRound, exact: false },
  { href: "/admin/settings/maintenance", label: "Settings", icon: Settings, exact: false },
];

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1 p-3", className)}>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
        Menu
      </p>
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(pathname, href, exact);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              active
                ? "bg-[var(--primary)]/14 text-[var(--foreground)] ring-1 ring-inset ring-[var(--primary)]/30"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/30 hover:text-[var(--foreground)]",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-canton" : undefined,
              )}
            />
            <span className="leading-snug">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
