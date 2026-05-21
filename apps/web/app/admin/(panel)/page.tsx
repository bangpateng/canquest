import Link from 'next/link';
import { cookies } from 'next/headers';
import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth-cookies';
import { internalApiBase } from '@/lib/internal-api-url';
import { Users, Scroll, Trophy, CheckCircle2, Plus } from 'lucide-react';

interface Stats {
  totalUsers: number;
  totalQuests: number;
  totalCompletions: number;
  totalWinners: number;
}

interface AdminQuest {
  id: string;
  title: string;
  org: string;
  status: string;
  rewardCc: number;
  rewardType: string;
  maxWinners: number | null;
  tags: string[];
  _count: { completions: number };
}

async function fetchAdmin<T>(path: string): Promise<T | null> {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${internalApiBase()}/admin${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const [stats, quests] = await Promise.all([
    fetchAdmin<Stats>('/stats'),
    fetchAdmin<AdminQuest[]>('/quests'),
  ]);

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0, icon: Users, color: 'text-blue-500' },
    { label: 'Active Quests', value: stats?.totalQuests ?? 0, icon: Scroll, color: 'text-violet-500' },
    { label: 'Quest Completions', value: stats?.totalCompletions ?? 0, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: 'Rewards Distributed', value: stats?.totalWinners ?? 0, icon: Trophy, color: 'text-amber-500' },
  ];

  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    COMING_SOON: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    ENDED: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-space)] text-2xl font-semibold">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Manage quests, winners, and reward distribution
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--muted)]"
          >
            <Users className="h-4 w-4" />
            Manage Users
          </Link>
          <Link
            href="/admin/quests/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New Quest
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--muted-foreground)]">{card.label}</p>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-bold tabular-nums">
              {card.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Quest list */}
      <div>
        <h2 className="mb-4 font-[family-name:var(--font-space)] text-lg font-semibold">
          All Quests
        </h2>
        {!quests || quests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
            <p className="font-semibold text-[var(--muted-foreground)]">No quests yet</p>
            <Link href="/admin/quests/new" className="mt-3 inline-block text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline">
              Create your first quest
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                  <th className="px-5 py-3 font-semibold">Quest</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Reward</th>
                  <th className="px-4 py-3 font-semibold">Completions</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quests.map((q, i) => (
                  <tr
                    key={q.id}
                    className={i % 2 === 0 ? 'bg-[var(--card)]' : 'bg-[var(--muted)]/20'}
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold">{q.title}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{q.org}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusColor[q.status] ?? ''}`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="font-medium">{q.rewardCc} CC</span>
                      {q.rewardType !== 'CC_ONLY' && (
                        <span className="ml-1 text-xs text-[var(--muted-foreground)]">+ codes</span>
                      )}
                      {q.maxWinners && (
                        <span className="ml-1 text-xs text-[var(--muted-foreground)]">({q.maxWinners} max)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--muted-foreground)]">
                      {q._count.completions}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/quests/${q.id}`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                        >
                          Manage
                        </Link>
                        <Link
                          href={`/admin/quests/${q.id}/winners`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                        >
                          Winners
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
