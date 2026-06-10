"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ListPagination } from "@/components/app/list/list-pagination";
import { filterTabClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { useCallback, useEffect, useState } from "react";

const PS = 5;
const TABS = [{ id: "weekly" as const, label: "Weekly" }, { id: "monthly" as const, label: "Monthly" }, { id: "all" as const, label: "All Time" }];
interface Row { rank: number; userId: string; username: string; displayName: string; twitterUsername?: string | null; points: number; avatarUrl: string | null; }
interface Data { rows: Row[]; total: number; page: number; pageSize: number; }
const GRADS = ["linear-gradient(145deg, #d4ff3f 0%, #8b9c0d 100%)", "linear-gradient(145deg, #60a5fa 0%, #1d4ed8 100%)", "linear-gradient(145deg, #f472b6 0%, #9333ea 100%)", "linear-gradient(145deg, #34d399 0%, #0d9488 100%)", "linear-gradient(145deg, #fb923c 0%, #c2410c 100%)", "linear-gradient(145deg, #a78bfa 0%, #6d28d9 100%)", "linear-gradient(145deg, #38bdf8 0%, #0369a1 100%)", "linear-gradient(145deg, #fbbf24 0%, #d97706 100%)"];
function ag(u: string) { let h = 0; for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) | 0; return GRADS[Math.abs(h) % GRADS.length]!; }
function as(u: string | null) { if (!u?.trim()) return null; const t = u.trim(); return t.includes("twimg.com") ? t : t; }
const APX = 48;

export function LeaderboardTable() {
  const [p, setP] = useState<"weekly" | "monthly" | "all">("weekly");
  const [pg, setPg] = useState(1);
  const [d, setD] = useState<Data | null>(null);
  const [l, setL] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => { fetch("/api/me", { credentials: "include", signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.json() : null).then((d: any) => { if (d?.id) setUid(d.id); }).catch(() => {}); }, []);

  const f = useCallback(async (pg: number, per: typeof p) => {
    setL(true);
    try { const r = await fetch(`/api/leaderboard?period=${per}&page=${pg}&pageSize=${PS}`, { cache: "no-store", signal: AbortSignal.timeout(12000) }); if (r.ok) setD(await r.json() as Data); else setD({ rows: [], total: 0, page: pg, pageSize: PS }); }
    catch { setD({ rows: [], total: 0, page: pg, pageSize: PS }); }
    finally { setL(false); }
  }, []);
  useEffect(() => { setPg(1); void f(1, p); }, [p, f]);
  const tp = d ? Math.max(1, Math.ceil(d.total / (d.pageSize || PS))) : 1;

  return (
    <div className="w-full max-w-full space-y-4">
      <div className="flex gap-1.5">{TABS.map(t => <button key={t.id} type="button" onClick={() => setP(t.id)} className={filterTabClass(p === t.id)}>{t.label}</button>)}</div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3 md:px-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Top Participants</h2>
          {d && <span className="text-xs text-[var(--muted-foreground)]">{d.total.toLocaleString()} participants</span>}
        </div>
        {l ? <div className="flex justify-center py-20"><LoadingSpinner size="xl" /></div>
        : !d || d.rows.length === 0 ? <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">No participants yet.</div>
        : <table className="w-full text-left">
            <thead className="text-xs font-semibold uppercase text-[var(--muted-foreground)]"><tr><th className="px-4 py-3 md:px-5">#</th><th className="px-3 py-3 md:px-4">Participant</th><th className="px-4 py-3 text-right md:px-5">Points</th></tr></thead>
            <tbody>
              {d.rows.map(r => { const cu = r.userId === uid;
                return <tr key={r.userId} className={cn("border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50", cu && "bg-[var(--primary)]/5")}>
                  <td className="px-4 py-3 md:px-5"><span className="text-sm font-bold tabular-nums text-[var(--foreground)]">{r.rank <= 3 ? ["","🥇","🥈","🥉"][r.rank] : r.rank}</span></td>
                  <td className="px-3 py-3 md:px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden ring-1 ring-[var(--border)]" style={as(r.avatarUrl) ? undefined : { backgroundImage: ag(r.username) }}>
                        {as(r.avatarUrl) ? <img src={as(r.avatarUrl)!} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-bold text-white">{r.displayName.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0,2)}</span>}
                      </div>
                      <div className="min-w-0"><p className="text-sm font-medium text-[var(--foreground)] truncate">{r.displayName}{cu && <span className="ml-1.5 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--primary)]">You</span>}</p>{r.twitterUsername && <p className="text-xs text-[var(--muted-foreground)]">@{r.twitterUsername}</p>}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right md:px-5"><span className="text-sm font-bold tabular-nums text-[var(--foreground)]">{r.points.toLocaleString()}</span> <span className="text-xs text-[var(--muted-foreground)]">pts</span></td>
                </tr>;
              })}
            </tbody>
          </table>}
        {!l && d && d.rows.length > 0 && <div className="border-t border-[var(--border)]"><ListPagination className="px-4 py-3" page={pg} totalPages={tp} total={d?.total} disabled={l} onPageChange={np => { setPg(np); void f(np, p); }} /></div>}
      </div>
    </div>
  );
}