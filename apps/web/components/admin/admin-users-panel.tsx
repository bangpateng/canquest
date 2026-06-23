'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Trash2, Shield, Ban, ShieldCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';
import { inputClass } from '@/lib/ui/ui-tokens';

type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

interface AdminUserRow {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  cantonPartyId: string | null;
  isAdmin: boolean;
  emailVerified: boolean;
  status: UserStatus;
  bannedAt: string | null;
  createdAt: string;
  balanceMicroCc: string;
  _count: { questCompletions: number };
}

interface UsersResponse {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function formatCc(micro: string) {
  const n = Number(micro) / 1_000_000;
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

function StatusBadge({ status }: { status: UserStatus }) {
  const styles: Record<UserStatus, string> = {
    ACTIVE: 'bg-emerald-500/15 text-emerald-300',
    SUSPENDED: 'bg-amber-500/15 text-amber-300',
    BANNED: 'bg-red-500/15 text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase',
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

export function AdminUsersPanel() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
    });
    if (search.trim()) params.set('q', search.trim());
    try {
      const res = await fetch(`/api/admin/users?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        setMessage('Failed to load users');
        setData(null);
        return;
      }
      const json = (await res.json()) as UsersResponse;
      setData(json);
      setSelected(new Set());
    } catch {
      setMessage('API unreachable');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data) return;
    const deletable = data.users.filter((u) => !u.isAdmin);
    if (selected.size === deletable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deletable.map((u) => u.id)));
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const emails = data?.users
      .filter((u) => selected.has(u.id))
      .map((u) => u.email)
      .join(', ');
    if (
      !confirm(
        `Delete ${selected.size} user(s)?\n\n${emails}\n\nAll their app data will be permanently removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      const json = (await res.json()) as {
        deleted?: number;
        blocked?: { email: string }[];
        message?: string;
      };
      if (!res.ok) {
        setMessage(json.message ?? 'Delete failed');
        return;
      }
      const blocked = json.blocked?.length
        ? ` (${json.blocked.length} admin skipped)`
        : '';
      setMessage(`Deleted ${json.deleted ?? 0} user(s)${blocked}`);
      await load();
    } catch {
      setMessage('Delete request failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteOne = async (user: AdminUserRow) => {
    if (user.isAdmin) {
      setMessage('Cannot delete admin accounts');
      return;
    }
    if (
      !confirm(
        `Delete ${user.email}?\n\nAll app data for this user will be permanently removed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { deleted?: number; message?: string };
      if (!res.ok) {
        setMessage(json.message ?? 'Delete failed');
        return;
      }
      setMessage(`Deleted ${user.email}`);
      await load();
    } catch {
      setMessage('Delete failed');
    } finally {
      setBusy(false);
    }
  };

  /** Ban (ACTIVE) or unban (SUSPENDED/BANNED). Admin rows are protected. */
  const setStatus = async (
    user: AdminUserRow,
    next: Exclude<UserStatus, never>,
  ) => {
    if (user.isAdmin) {
      setMessage('Cannot ban or suspend an admin account');
      return;
    }
    let body: { status: UserStatus; reason?: string } = { status: next };
    if (next !== 'ACTIVE') {
      const reason = window.prompt(
        `Reason for ${next.toLowerCase()} ${user.email}? (optional)`,
        '',
      );
      // Cancel the prompt → abort the action.
      if (reason === null) return;
      body = { status: next, reason: reason.trim() || undefined };
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok) {
        setMessage(json.message ?? 'Status update failed');
        return;
      }
      setMessage(
        `${user.email} → ${next}${body.reason ? ` (${body.reason})` : ''}`,
      );
      await load();
    } catch {
      setMessage('Status update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="search"
            placeholder="Search email or username…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={cn(inputClass, "py-2.5 pl-10 pr-4")}
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={buttonVariants({ variant: "secondary" })}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void deleteSelected()}
          disabled={busy || selected.size === 0}
          className={cn(buttonVariants({ variant: "danger" }), "gap-2 bg-red-600 text-white hover:bg-red-500 disabled:opacity-50")}
        >
          <Trash2 className="h-4 w-4" />
          Delete selected ({selected.size})
        </button>
      </div>

      {message && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-sm">
          {message}
        </p>
      )}

      <p className="text-xs text-[var(--muted-foreground)]">
        Deleting a user removes all app data for that account: login, refresh tokens, CC balance, transaction history, quest completions, submissions, winner records, and spin results. Quest campaigns stay. On-chain Canton wallet/party is not removed from the validator.
      </p>

      {loading && !data ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : !data || data.users.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No users found.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      data.users.filter((u) => !u.isAdmin).length > 0 &&
                      selected.size === data.users.filter((u) => !u.isAdmin).length
                    }
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Balance</th>
                <th className="px-4 py-3 font-semibold">Quests</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u, i) => (
                <tr
                  key={u.id}
                  className={i % 2 === 0 ? 'bg-[var(--card)]' : 'bg-[var(--muted)]/20'}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={u.isAdmin}
                      checked={selected.has(u.id)}
                      onChange={() => toggle(u.id)}
                      aria-label={`Select ${u.email}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{u.email}</p>
                      {u.isAdmin && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-300 dark:text-orange-300">
                          <Shield className="h-3 w-3" />
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {u.username ? `@${u.username}` : '—'}
                      {u.cantonPartyId ? ' · party bound' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                    {u.status !== 'ACTIVE' && u.bannedAt ? (
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        {new Date(u.bannedAt).toLocaleDateString()}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatCc(u.balanceMicroCc)} CC</td>
                  <td className="px-4 py-3 tabular-nums">{u._count.questCompletions}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {u.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          disabled={busy || u.isAdmin}
                          onClick={() => void setStatus(u, 'BANNED')}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-40 dark:text-red-400"
                        >
                          <Ban className="h-3 w-3" />
                          Ban
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setStatus(u, 'ACTIVE')}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1 text-xs font-semibold text-emerald-600 disabled:opacity-40 dark:text-emerald-400"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Unban
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy || u.isAdmin}
                        onClick={() => void deleteOne(u)}
                        className="rounded-lg border border-red-500/30 px-3 py-1 text-xs font-semibold text-red-600 disabled:opacity-40 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--muted-foreground)]">
            Page {data.page} of {data.totalPages} ({data.total} users)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
