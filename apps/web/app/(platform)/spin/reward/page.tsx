"use client";
import { PlatformPage } from "@/components/platform/platform-page";
import { useEffect, useState, useCallback, useRef } from "react";
import { Ticket, Gift, Coins, Star, AlertCircle, Trophy, Zap, Sparkles } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils/utils";

interface SpinItem { id: string; label: string; rewardType: string; rewardCc: number; rewardPoints: number; probability: number; color: string; icon: string; }
interface SpinState { spinCost: number; earnPoints: number; spentPoints: number; availablePoints: number; }
interface SpinResult { ok: boolean; spinResultId: string; item: SpinItem; pointsSpent: number; message: string; }

const PALETTE: [string, string][] = [["#06b6d4","#0891b2"],["#6366f1","#4f46e5"],["#f59e0b","#d97706"],["#10b981","#059669"],["#f43f5e","#e11d48"],["#8b5cf6","#7c3aed"],["#0ea5e9","#0284c7"],["#ec4899","#db2777"],["#14b8a6","#0d9488"],["#a855f7","#9333ea"],["#22c55e","#16a34a"],["#fb923c","#ea580c"]];
function segColor(item: SpinItem, i: number): [string, string] { if (!item.color||item.color==="#6366f1"||item.color==="#d4ff3f") return PALETTE[i%PALETTE.length]!; return [item.color, item.color+"cc"]; }

function SpinWheel({ items, spinning, winnerIndex, onSpinComplete }: { items: SpinItem[]; spinning: boolean; winnerIndex: number | null; onSpinComplete?: () => void }) {
  const cr = useRef<HTMLCanvasElement>(null); const rr = useRef(0); const ar = useRef<number>(0);
  const [dr, setDr] = useState(0); const ir = useRef(false); const is = useRef(0);
  const [ws, setWs] = useState(340);
  useEffect(() => { function u() { setWs(Math.min(340, window.innerWidth - 48)); } u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u); }, []);

  const draw = useCallback((r: number) => {
    const c = cr.current; if (!c || items.length === 0) return; const ctx = c.getContext("2d"); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; const s = c.width / dpr; const cx = s / 2, cy = s / 2;
    const oR = s / 2 - 8; const iR = Math.max(22, s * 0.094); const sa = (2 * Math.PI) / items.length;
    ctx.clearRect(0, 0, c.width, c.height); ctx.save(); ctx.scale(dpr, dpr);
    ctx.beginPath(); ctx.arc(cx, cy, oR + 7, 0, 2 * Math.PI); ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2; ctx.stroke();
    items.forEach((it, i) => { const [f, e] = segColor(it, i); const sa2 = r + i * sa; const ma = sa2 + sa / 2;
      const g = ctx.createLinearGradient(cx + oR * 0.85 * Math.cos(ma), cy + oR * 0.85 * Math.sin(ma), cx + iR * Math.cos(ma), cy + iR * Math.sin(ma)); g.addColorStop(0, f); g.addColorStop(1, e);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, oR, sa2, sa2 + sa); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, oR, sa2, sa2 + sa); ctx.closePath(); ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ma); ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(7, Math.min(13, 180 / items.length))}px system-ui`; ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 4; ctx.fillStyle = "#fff";
      const mc = items.length > 8 ? 9 : 12; ctx.fillText(it.label.length > mc ? it.label.slice(0, mc - 1) + "\u2026" : it.label, oR - 8, 0); ctx.restore(); });
    ctx.restore();
  }, [items]);

  useEffect(() => { const c = cr.current; if (!c) return; c.width = ws * (window.devicePixelRatio || 1); c.height = ws * (window.devicePixelRatio || 1); }, [ws]);
  useEffect(() => { draw(dr); }, [draw, dr, items, ws]);

  useEffect(() => { if (!spinning) { ir.current = false; cancelAnimationFrame(ar.current); return; } ir.current = true; is.current = 0.04;
    const acc = () => { if (!ir.current) return; is.current = Math.min(is.current + 0.004, 0.22); rr.current += is.current; setDr(rr.current); ar.current = requestAnimationFrame(acc); }; ar.current = requestAnimationFrame(acc); return () => cancelAnimationFrame(ar.current); }, [spinning]);

  useEffect(() => { if (winnerIndex === null || spinning || items.length === 0) return; cancelAnimationFrame(ar.current);
    const sa2 = (2 * Math.PI) / items.length; const tb = -Math.PI / 2 - winnerIndex * sa2 - sa2 / 2;
    const cn2 = ((rr.current % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); const tn = ((tb % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let delta = tn - cn2; if (delta < 0) delta += 2 * Math.PI;
    const td = delta + 5 * 2 * Math.PI; const sR = rr.current; const dur = 3200 + Math.min(td * 80, 1200); const st = performance.now();
    const anim = (now: number) => { const t = Math.min((now - st) / dur, 1); const e = 1 - Math.pow(1 - t, 4); rr.current = sR + td * e; setDr(rr.current);
      if (t < 1) ar.current = requestAnimationFrame(anim); else { rr.current = sR + td; setDr(sR + td); onSpinComplete?.(); } }; ar.current = requestAnimationFrame(anim);
    return () => cancelAnimationFrame(ar.current); }, [winnerIndex, items.length]);

  if (items.length === 0) return null;
  const gs = ws + 40, rs = ws + 16;
  return <div className="relative flex items-center justify-center select-none">
    <div className="pointer-events-none absolute rounded-full" style={{ width: gs, height: gs, background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)", filter: `blur(${Math.max(12, ws * 0.07)}px)` }} />
    <div className="pointer-events-none absolute rounded-full" style={{ width: rs, height: rs, border: "1px solid rgba(255,255,255,0.04)" }} />
    <svg className="pointer-events-none absolute z-10" style={{ top: -2, left: "50%", transform: "translateX(-50%)" }} width="28" height="36" viewBox="0 0 28 36" fill="none">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e"/><stop offset="100%" stopColor="#be123c"/></linearGradient></defs>
      <path d="M14 2 L3 28 Q14 22 25 28 Z" fill="url(#pg)"/><path d="M14 2 L3 28 Q14 22 25 28 Z" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/><circle cx="14" cy="4" r="2.5" fill="rgba(255,255,255,0.4)"/>
    </svg>
    <canvas ref={cr} className="relative rounded-full" style={{ width: ws, height: ws }} />
  </div>;
}

export default function SpinRewardPage() {
  const [items, setItems] = useState<SpinItem[]>([]); const [state, setState] = useState<SpinState | null>(null);
  const [spinning, setSpinning] = useState(false); const [wi, setWi] = useState<number | null>(null);
  const [lr, setLr] = useState<SpinResult | null>(null); const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [sr, setSr] = useState(false);

  const load = useCallback(async () => { try {
    const [ir, sr] = await Promise.all([fetch("/api/spin/items", { credentials: "include" }), fetch("/api/spin/state", { credentials: "include" })]);
    if (ir.ok) setItems(await ir.json() as SpinItem[]); if (sr.ok) setState(await sr.json() as SpinState);
  } catch { setErr("Failed to load"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function spin() { if (spinning || !state) return; setErr(null); setLr(null); setWi(null); setSr(false); setSpinning(true);
    try { const r = await fetch("/api/spin/execute", { method: "POST", credentials: "include" }); const d = await r.json() as SpinResult & { message?: string };
      if (!r.ok || !d.ok) { setErr(d.message ?? "Spin failed"); setSpinning(false); return; }
      setSpinning(false); setWi(items.findIndex(i => i.id === d.item.id)); setLr(d); } catch { setErr("Network error"); setSpinning(false); } }

  const can = !spinning && (wi === null || sr) && state !== null && state.availablePoints >= state.spinCost && items.length > 0;
  if (loading) return <PlatformPage><div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner size="lg" /></div></PlatformPage>;

  return <PlatformPage>
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center gap-3"><Ticket className="h-5 w-5 text-cyan-400" /><h1 className="text-lg font-bold text-[var(--foreground)]">Lucky Spin</h1>{state && <span className="ml-auto text-xs text-[var(--muted-foreground)]">{state.availablePoints.toLocaleString()} pts</span>}</div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        {items.length === 0 ? <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center"><Gift className="h-10 w-10 text-[var(--muted-foreground)]" /><p className="text-sm font-medium text-[var(--foreground)]">Create a wallet to spin</p></div>
        : <div className="flex flex-col items-center gap-4 px-4 py-6"><SpinWheel items={items} spinning={spinning} winnerIndex={wi} onSpinComplete={() => { setSr(true); void load(); }} />
          {sr && lr && <div className="w-full max-w-sm rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3"><p className="text-xs font-semibold text-emerald-400">You won! {lr.item.label}</p><p className="text-xs text-[var(--muted-foreground)]">{lr.message}</p></div>}
          {err && <div className="w-full max-w-sm rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">{err}</div>}
          <button type="button" onClick={() => void spin()} disabled={!can} className={cn("w-full max-w-sm rounded-lg px-6 py-3 text-sm font-semibold transition-colors", can ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed")}>
            {spinning ? "Spinning..." : wi !== null && !sr ? "Revealing..." : <><Ticket className="inline h-4 w-4 mr-1.5" />Spin Now {state && `(${state.spinCost} pts)`}</>}</button>
        </div>}
      </div>
      {state && <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm px-4 py-3 flex items-center justify-between text-sm"><span className="text-[var(--muted-foreground)]">Available</span><span className="font-bold text-[var(--foreground)]">{state.availablePoints.toLocaleString()} pts</span><span className="text-[var(--muted-foreground)]">Cost: {state.spinCost} pts</span></div>}
    </div>
  </PlatformPage>;
}