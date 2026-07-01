'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';

type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

interface FraudReferral {
  rewardId: string;
  referrerId: string;
  referrerEmail: string;
  referredUserId: string;
  referredEmail: string;
  referredDomain: string;
  isGmailAlias: boolean;
  canonicalEmail: string;
  referredStatus: UserStatus | null;
  points: number;
  createdAt: string;
}

interface FraudReferrer {
  referrerId: string;
  referrerEmail: string;
  referrerEarnPoints: number;
  isAdmin: boolean;
  isProtected: boolean;
  flaggedCount: number;
  totalPoints: number;
}

interface FraudResponse {
  totalFlagged: number;
  referrers: FraudReferrer[];
  referrals: FraudReferral[];
}

export function AdminReferralAuditPanel() {
  const [data, setData] = useState<FraudResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // referredUserId
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // referrerId

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/users/referrals/fraud', {
        cache: 'no-store',
      });
      if (!res.ok) {
        setMessage('Failed to load fraud report');
        setData(null);
        return;
      }
      const json = (await res.json()) as FraudResponse;
      setData(json);
      setSelected(new Set());
    } catch {
      setMessage('API unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleReferral = (referredUserId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(referredUserId)) next.delete(referredUserId);
      else next.add(referredUserId);
      return next;
    });
  };

  const selectAllFlagged = () => {
    if (!data) return;
    if (selected.size === data.referrals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.referrals.map((r) => r.referredUserId)));
    }
  };

  const revokeSelected = async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Remove ${selected.size} flagged referral(s)?\n\nEach referrer loses the points from these referrals (clawback). The referred users stay but lose their referral link. This runs server-side in one batch.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/referrals/revoke-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referredUserIds: [...selected] }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        revoked?: number;
        pointsClawedBack?: number;
        referrersUpdated?: number;
        message?: string;
      };
      if (!res.ok) {
        setMessage(j.message ?? 'Bulk remove failed');
        return;
      }
      setMessage(
        `Removed ${j.revoked ?? 0} referral(s) · clawed back ${j.pointsClawedBack ?? 0} pts across ${j.referrersUpdated ?? 0} referrer(s).`,
      );
      await load();
    } catch {
      setMessage('Request failed');
    } finally {
      setBusy(false);
    }
  };

  /** Hapus SEMUA referral yang auto-flag (di luar allowlist) sekaligus di server. */
  const revokeAllFlagged = async () => {
    if (!data || data.totalFlagged === 0) return;
    if (
      !confirm(
        `Remove ALL ${data.totalFlagged} flagged referral(s)?\n\nThis removes every referral whose email is outside the allowed webmail list, and claws back all their points across every referrer in one server-side batch. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/referrals/revoke-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        revoked?: number;
        pointsClawedBack?: number;
        referrersUpdated?: number;
        message?: string;
      };
      if (!res.ok) {
        setMessage(j.message ?? 'Bulk remove failed');
        return;
      }
      setMessage(
        `Removed ${j.revoked ?? 0} referral(s) · clawed back ${j.pointsClawedBack ?? 0} pts across ${j.referrersUpdated ?? 0} referrer(s).`,
      );
      await load();
    } catch {
      setMessage('Request failed');
    } finally {
      setBusy(false);
    }
  };

  const revokeOne = async (r: FraudReferral) => {
    if (
      !confirm(
        `Remove referral from ${r.referredEmail}?\n\n${r.referrerEmail} loses ${r.points} points.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/referrals/${r.referredUserId}`, {
        method: 'DELETE',
      });
      const j = (await res.json().catch(() => ({}))) as {
        pointsClawedBack?: number;
        message?: string;
      };
      if (!res.ok) {
        setMessage(j.message ?? 'Revoke failed');
        return;
      }
      setMessage(`Removed · clawed back ${j.pointsClawedBack ?? r.points} pts`);
      await load();
    } catch {
      setMessage('Revoke failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = (referrerId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(referrerId)) next.delete(referrerId);
      else next.add(referrerId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={buttonVariants({ variant: 'secondary' })}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </button>
        <button
          type="button"
          onClick={selectAllFlagged}
          disabled={!data || data.referrals.length === 0}
          className={buttonVariants({ variant: 'secondary' })}
        >
          {data && selected.size === data.referrals.length && selected.size > 0
            ? 'Clear selection'
            : `Select all flagged${data ? ` (${data.referrals.length})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => void revokeSelected()}
          disabled={busy || selected.size === 0}
          className={cn(
            buttonVariants({ variant: 'danger' }),
            'gap-2 bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
          )}
        >
          <Trash2 className="h-4 w-4" />
          Remove selected {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        <button
          type="button"
          onClick={() => void revokeAllFlagged()}
          disabled={busy || !data || data.totalFlagged === 0}
          title="Remove every referral outside the allowed webmail list, in one server-side batch"
          className={cn(
            buttonVariants({ variant: 'danger' }),
            'gap-2 border-red-400 bg-transparent text-red-500 hover:bg-red-600 hover:text-white disabled:opacity-50',
          )}
        >
          <Trash2 className="h-4 w-4" />
          Remove ALL flagged{data ? ` (${data.totalFlagged})` : ''}
        </button>
      </div>

      {message && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-sm">
          {message}
        </p>
      )}

      {loading && !data ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : !data || data.totalFlagged === 0 ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-8 text-center">
          <p className="font-semibold text-emerald-300">
            No flagged referrals found
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            All referrals use allowed webmail domains with no alias farming.
            Nothing to clean up.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              {data.totalFlagged} referral(s) flagged
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Flagged when the referred email is from a non-webmail domain OR a
              Gmail alias (dots/plus, e.g. gener.a.tor@gmail.com = generator@gmail.com).
              Normal Gmail/Yahoo/Outlook are NOT flagged. Top referrers below —
              expand to remove individual referrals.
            </p>
          </div>

          {/* Ringkasan per-pengundang */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                  <th className="px-4 py-3 font-semibold">Referrer</th>
                  <th className="px-4 py-3 font-semibold">Flagged invites</th>
                  <th className="px-4 py-3 font-semibold">Points at risk</th>
                  <th className="px-4 py-3 font-semibold">Now</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.referrers.map((ref, i) => (
                  <Fragment key={ref.referrerId}>
                    <tr
                      className={i % 2 === 0 ? 'bg-[var(--card)]' : 'bg-[var(--muted)]/20'}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold">
                          {ref.referrerEmail}
                          {ref.isAdmin && (
                            <span className="ml-2 inline-flex rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-300">
                              admin
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{ref.flaggedCount}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-red-300">
                        {ref.totalPoints}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {ref.referrerEarnPoints.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleExpand(ref.referrerId)}
                          className="text-xs font-semibold text-blue-300 hover:underline"
                        >
                          {expanded.has(ref.referrerId) ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                    {expanded.has(ref.referrerId) && (
                      <tr className="bg-[var(--muted)]/10">
                        <td colSpan={5} className="px-4 py-3">
                          <ul className="space-y-2">
                            {data.referrals
                              .filter((r) => r.referrerId === ref.referrerId)
                              .map((r) => (
                                <li
                                  key={r.rewardId}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={selected.has(r.referredUserId)}
                                      onChange={() => toggleReferral(r.referredUserId)}
                                      aria-label={`Select ${r.referredEmail}`}
                                    />
                                    <div>
                                      <p className="font-medium">
                                        {r.referredEmail}{' '}
                                        {r.isGmailAlias ? (
                                          <span
                                            className="ml-1 inline-flex rounded-md bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-300"
                                            title={`Gmail alias — canonical: ${r.canonicalEmail}`}
                                          >
                                            gmail alias
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold uppercase text-red-300">
                                            @{r.referredDomain}
                                          </span>
                                        )}
                                      </p>
                                      <p className="text-[11px] text-[var(--muted-foreground)]">
                                        {r.points} pts ·{' '}
                                        {new Date(r.createdAt).toLocaleDateString()}
                                        {r.isGmailAlias && (
                                          <span className="text-purple-300/80">
                                            {' '}· = {r.canonicalEmail}
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void revokeOne(r)}
                                    className="rounded-lg border border-red-500/30 px-3 py-1 text-xs font-semibold text-red-600 disabled:opacity-40 dark:text-red-400"
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
