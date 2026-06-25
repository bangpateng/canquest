import Link from "next/link";
import { cookies } from "next/headers";
import { CQ_ADMIN_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { internalApiBase } from "@/lib/api/internal-api-url";
import {
  Users,
  Scroll,
  Trophy,
  CheckCircle2,
  Sparkles,
  Gift,
  KeyRound,
  Coins,
  Ticket,
} from "lucide-react";

interface Stats {
  totalUsers: number;
  totalQuests: number;
  totalCompletions: number;
  totalWinners: number;
  campaignQuests?: number;
  earnHubConfigured?: boolean;
  earnHubTaskCount?: number;
  earnHubSubmissions?: number;
  totalCcDistributed?: number;
  codesAvailable?: number;
}

async function fetchAdmin<T>(path: string): Promise<T | null> {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${internalApiBase()}/admin${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const stats = await fetchAdmin<Stats>("/stats");

  const statCards = [
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users },
    {
      label: "Earn campaigns",
      value: stats?.campaignQuests ?? stats?.totalQuests ?? 0,
      icon: Scroll,
    },
    {
      label: "Quest hub tasks",
      value: stats?.earnHubTaskCount ?? 0,
      icon: Gift,
    },
    {
      label: "Completions",
      value: stats?.totalCompletions ?? 0,
      icon: CheckCircle2,
    },
    {
      label: "Rewards sent",
      value: stats?.totalWinners ?? 0,
      icon: Trophy,
    },
    {
      label: "CC distributed",
      value: stats?.totalCcDistributed ?? 0,
      icon: Coins,
    },
    {
      label: "Codes available",
      value: stats?.codesAvailable ?? 0,
      icon: Ticket,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="type-page-title">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Manage user menu <strong>Earn</strong> (campaigns) and <strong>Quest</strong> (CanQuest
          Earn hub) from separate sections.
        </p>
      </div>

      {/* Stat cards — warna ikon konsisten (semua canton), value pakai type-stat. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--muted-foreground)]">{card.label}</p>
              <card.icon className="h-5 w-5 text-canton" />
            </div>
            <p className="type-stat mt-2">{card.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/admin/wallet-invites"
          className="group rounded-2xl border border-canton-muted bg-canton-subtle p-6 transition-colors hover:border-canton-muted"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-soft text-canton">
              <KeyRound className="h-5 w-5" />
            </span>
          </div>
          <h2 className="type-section-title mt-4">Generate wallet codes</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Create one-time invite codes users need before creating a Canton wallet. One code = one
            user after successful wallet setup.
          </p>
          <p className="mt-3 text-xs font-semibold text-canton">Open generator →</p>
        </Link>

        <Link
          href="/admin/earn"
          className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 transition-colors hover:border-[var(--primary)]/35"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-soft text-canton">
              <Sparkles className="h-5 w-5" />
            </span>
          </div>
          <h2 className="type-section-title mt-4">Earn</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Partner campaigns — create quests, upload banners, invite codes, draw winners, CC
            rewards.
          </p>
          <p className="mt-3 text-xs font-semibold text-canton">
            {stats?.campaignQuests ?? 0} campaign(s)
          </p>
        </Link>

        <Link
          href="/admin/quests"
          className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 transition-colors hover:border-[var(--primary)]/35"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-soft text-canton">
              <Gift className="h-5 w-5" />
            </span>
          </div>
          <h2 className="type-section-title mt-4">Quest</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            CanQuest Earn hub — daily check-in, social tasks, quizzes, earn points (one hub for all
            users).
          </p>
          <p className="mt-3 text-xs font-semibold text-canton">
            {stats?.earnHubConfigured
              ? `${stats.earnHubTaskCount ?? 0} task(s) · ${stats.earnHubSubmissions ?? 0} submissions`
              : "Not configured — open to set up"}
          </p>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2.5 text-sm font-semibold transition-colors hover:border-[var(--primary)]/30"
        >
          <Users className="h-4 w-4" />
          Manage users
        </Link>
      </div>
    </div>
  );
}
