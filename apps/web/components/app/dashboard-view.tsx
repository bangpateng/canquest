"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gift,
  Loader2,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";

interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
}

interface DashboardStats {
  totalPoints: number;
  questsCompleted: number;
  txCount: number;
  weeklyRank: number;
}

interface ActivityItem {
  type: "quest_completed" | "task_verified" | "cc_transfer";
  title: string;
  detail: string;
  time: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ElementType> = {
  quest_completed: Trophy,
  task_verified: CheckCircle2,
  cc_transfer: Coins,
};

const ACTIVITY_COLOR: Record<ActivityItem["type"], string> = {
  quest_completed: "bg-[var(--primary)]/15 text-[var(--foreground)]",
  task_verified: "bg-green-500/10 text-green-600 dark:text-green-400",
  cc_transfer: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

export function DashboardView() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, statsRes, actRes, balRes] = await Promise.allSettled([
        fetch("/api/me", { credentials: "include", cache: "no-store" }),
        fetch("/api/quests/dashboard-stats", { credentials: "include" }),
        fetch("/api/quests/activity?limit=8", { credentials: "include" }),
        fetch("/api/party/balance", { credentials: "include" }),
      ]);

      if (meRes.status === "fulfilled" && meRes.value.ok) {
        setMe((await meRes.value.json()) as Me);
      }
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        setStats((await statsRes.value.json()) as DashboardStats);
      }
      if (actRes.status === "fulfilled" && actRes.value.ok) {
        setActivities((await actRes.value.json()) as ActivityItem[]);
      }
      if (balRes.status === "fulfilled" && balRes.value.ok) {
        const d = (await balRes.value.json()) as { balance?: number | null };
        setBalance(d.balance ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const hasWallet =
    Boolean(me?.cantonPartyId) && !me?.cantonPartyId?.startsWith("canquest:user:");

  const statCards = [
    {
      title: "Quest points",
      value: loading ? null : (stats?.totalPoints ?? 0).toLocaleString(),
      hint: "Lifetime points from verified tasks",
      icon: TrendingUp,
    },
    {
      title: "CC Balance",
      value: loading
        ? null
        : !hasWallet
          ? "No wallet"
          : balance !== null
            ? `${balance.toFixed(4)} CC`
            : "—",
      hint: hasWallet ? "Live from Splice Validator" : "Create wallet first",
      icon: Coins,
    },
    {
      title: "Weekly rank",
      value: loading ? null : stats?.weeklyRank ? `#${stats.weeklyRank}` : "—",
      hint: "Based on points earned this week",
      icon: Trophy,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      {!loading && me?.displayName && (
        <div>
          <h1 className="font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
            Welcome back, {me.displayName.split(" ")[0]}
          </h1>
          {me.username && (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              @{me.username}
              {me.cantonPartyId && !me.cantonPartyId.startsWith("canquest:") && (
                <span className="ml-2 inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Wallet active
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="glass-card rounded-2xl border border-[var(--border)] p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {c.title}
                </p>
                <Icon className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden />
              </div>
              <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight">
                {c.value === null ? (
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  c.value
                )}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{c.hint}</p>
            </div>
          );
        })}
      </section>

      {/* Second row: quests completed card */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-2xl border border-[var(--border)] p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Quests completed
            </p>
            <Gift className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden />
          </div>
          <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
            ) : (
              (stats?.questsCompleted ?? 0).toString()
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Total quests with all tasks verified
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-[var(--border)] p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              CC Transactions
            </p>
            <Zap className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden />
          </div>
          <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
            ) : (
              (stats?.txCount ?? 0).toString()
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Recorded on-chain transfers
          </p>
        </div>

        {!hasWallet && !loading && (
          <div className="glass-card rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Wallet not created
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Create your Canton wallet to send and receive CC tokens.
            </p>
            <Link
              href="/wallet"
              className={cn(buttonVariants({ size: "sm" }), "mt-4 gap-1")}
            >
              Create Wallet <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </section>

      {/* Activity + Actions */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Recent Activity */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold">
                Recent activity
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Your latest quest completions, tasks, and CC transfers.
              </p>
            </div>
            <Link
              href="/transactions"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "inline-flex shrink-0 gap-1",
              )}
            >
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : activities.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] py-10 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                No activity yet — complete a quest to get started!
              </p>
              <Link
                href="/quests"
                className={cn(buttonVariants({ size: "sm" }), "mx-auto mt-4 gap-1")}
              >
                Browse quests
              </Link>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-[var(--border)]">
              {activities.map((item, i) => {
                const Icon = ACTIVITY_ICON[item.type];
                const colorClass = ACTIVITY_COLOR[item.type];
                return (
                  <li
                    key={`${item.type}-${item.time}-${i}`}
                    className="flex items-start gap-3 py-3"
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        colorClass,
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--foreground)]">{item.title}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">{item.detail}</p>
                    </div>
                    <p className="shrink-0 text-xs text-[var(--muted-foreground)] pt-0.5">
                      {timeAgo(item.time)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quick actions */}
        <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-6">
          <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold">
            Quick actions
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              {me?.displayName
                ? `Hello, ${me.displayName}`
                : "Welcome to CanQuest"}{" "}
              — earn CC rewards by completing verified quests on the Canton Network.
            </p>
          )}
          <div className="mt-auto flex flex-col gap-2">
            <Link
              href="/quests"
              className={cn(buttonVariants({ size: "sm" }), "justify-center gap-2")}
            >
              <Gift className="h-4 w-4" />
              Browse quests
            </Link>
            <Link
              href="/wallet"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "justify-center gap-2",
              )}
            >
              <Coins className="h-4 w-4" />
              View wallet
            </Link>
            <Link
              href="/leaderboard"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "justify-center gap-2",
              )}
            >
              <Trophy className="h-4 w-4" />
              Leaderboard
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
