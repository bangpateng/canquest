"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Coins,
  Globe2,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface StatsData {
  ccPrice: number | null;
  activeCampaigns: number;
  communitySize: number | null;
  networkOnline: boolean;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accentClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accentClass: string;
}) {
  return (
    <Card className="flex items-center gap-4 overflow-hidden p-4 sm:p-5">
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          accentClass,
        )}
      >
        <Icon className="h-5 w-5 text-[var(--foreground)]" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </p>
        <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-[var(--foreground)] sm:text-xl">
          {value}
        </p>
        {sub ? (
          <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>
        ) : null}
      </div>
    </Card>
  );
}

export function NetworkStatsBar() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [pricesRes, questsRes, leaderboardRes, ledgerRes] =
          await Promise.allSettled([
            fetch("/api/party/prices", { credentials: "include" }),
            fetch("/api/quests", { credentials: "include" }),
            fetch("/api/leaderboard?limit=1", { credentials: "include" }),
            fetch("/api/party/ledger-status", { credentials: "include" }),
          ]);

        let ccPrice: number | null = null;
        if (pricesRes.status === "fulfilled" && pricesRes.value.ok) {
          const data = await pricesRes.value.json();
          ccPrice = data?.prices?.amulet ?? null;
        }

        let activeCampaigns = 0;
        if (questsRes.status === "fulfilled" && questsRes.value.ok) {
          const data = await questsRes.value.json();
          activeCampaigns = (Array.isArray(data) ? data : data?.quests ?? [])
            .filter(
              (q: { status?: string; questKind?: string }) =>
                q.status === "ACTIVE" && q.questKind === "CAMPAIGN",
            )
            .length;
        }

        let communitySize: number | null = null;
        if (leaderboardRes.status === "fulfilled" && leaderboardRes.value.ok) {
          const data = await leaderboardRes.value.json();
          communitySize = data?.totalUsers ?? data?.total ?? null;
        }

        let networkOnline = true;
        if (ledgerRes.status === "fulfilled" && ledgerRes.value.ok) {
          const data = await ledgerRes.value.json();
          networkOnline = data?.reachable !== false;
        }

        if (!cancelled) {
          setStats({ ccPrice, activeCampaigns, communitySize, networkOnline });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="lg" tone="muted" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        icon={TrendingUp}
        label="CC Price"
        value={stats?.ccPrice ? `$${stats.ccPrice.toFixed(4)}` : "—"}
        sub="Live amulet price"
        accentClass="bg-emerald-500/15 text-emerald-600"
      />
      <StatCard
        icon={Zap}
        label="Live Campaigns"
        value={String(stats?.activeCampaigns ?? 0)}
        sub="Accepting participants"
        accentClass="bg-violet-500/15 text-violet-600"
      />
      <StatCard
        icon={Users}
        label="Community"
        value={
          stats?.communitySize
            ? stats.communitySize.toLocaleString()
            : "2,900+"
        }
        sub="Verified members"
        accentClass="bg-amber-500/15 text-amber-600"
      />
      <StatCard
        icon={Globe2}
        label="Network"
        value={stats?.networkOnline ? "Online" : "Syncing…"}
        sub="Canton mainnet"
        accentClass={
          stats?.networkOnline
            ? "bg-canton-subtle text-canton"
            : "bg-orange-500/15 text-orange-600"
        }
      />
    </div>
  );
}
