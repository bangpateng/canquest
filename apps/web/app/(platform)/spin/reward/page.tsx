"use client";

import { PlatformPage } from "@/components/platform/platform-page";
import { useEffect, useState, useCallback, useRef } from "react";
import { Ticket, RefreshCw, Gift, Coins, Star, AlertCircle, Trophy, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils/utils";

interface SpinItem {
  id: string;
  label: string;
  rewardType: string;
  rewardCc: number;
  rewardPoints: number;
  probability: number;
  color: string;
  icon: string;
}

interface SpinState {
  spinCost: number;
  earnPoints: number;
  spentPoints: number;
  availablePoints: number;
}

interface SpinResult {
  ok: boolean;
  spinResultId: string;
  item: SpinItem;
  pointsSpent: number;
  message: string;
}

interface SpinHistory {
  id: string;
  item: SpinItem;
  pointsSpent: number;
  delivered: boolean;
  ledgerTxId: string | null;
  createdAt: string;
}

// Warna sesuai tema Canton — cyan/indigo/purple palette
const SEGMENT_COLORS = [
  "#06b6d4", // canton cyan
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#22d3ee", // cyan-400
  "#818cf8", // indigo-400
  "#c084fc", // purple-400
  "#38bdf8", // sky-400
  "#60a5fa", // blue-400
];

function SpinWheel({
  items,
  spinning,
  winnerIndex,
}: {
  items: SpinItem[];
  spinning: boolean;
  winnerIndex: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const [displayRotation, setDisplayRotation] = useState(0);

  const drawWheel = useCallback(
    (rotation: number) => {
      const canvas = canvasRef.current;
      if (!canvas || items.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const size = canvas.width / dpr;
      const cx = size / 2;
      const cy = size / 2;
      const outerRadius = size / 2 - 6;
      const innerRadius = 28;
      const segAngle = (2 * Math.PI) / items.length;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Outer glow ring
      const grd = ctx.createRadialGradient(cx, cy, outerRadius - 8, cx, cy, outerRadius + 4);
      grd.addColorStop(0, "rgba(6,182,212,0.0)");
      grd.addColorStop(1, "rgba(6,182,212,0.18)");
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = grd;
      ctx.fill();

      // Segments
      items.forEach((item, i) => {
        const startAngle = rotation + i * segAngle - Math.PI / 2;
        const endAngle = startAngle + segAngle;
        const color = item.color && item.color !== "#6366f1"
          ? item.color
          : SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? "#06b6d4";

        // Segment fill with gradient
        const midAngle = startAngle + segAngle / 2;
        const gx = cx + (outerRadius * 0.6) * Math.cos(midAngle);
        const gy = cy + (outerRadius * 0.6) * Math.sin(midAngle);
        const segGrd = ctx.createRadialGradient(gx, gy, 0, cx, cy, outerRadius);
        segGrd.addColorStop(0, color + "ff");
        segGrd.addColorStop(1, color + "bb");

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = segGrd;
        ctx.fill();

        // Segment border
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + segAngle / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        const fontSize = Math.max(9, Math.min(12, 180 / items.length));
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 4;
        const label = item.label.length > 11 ? item.label.slice(0, 10) + "…" : item.label;
        ctx.fillText(label, outerRadius - 12, fontSize / 3);
        ctx.restore();
      });

      // Inner shadow ring
      const shadowGrd = ctx.createRadialGradient(cx, cy, innerRadius - 2, cx, cy, innerRadius + 16);
      shadowGrd.addColorStop(0, "rgba(0,0,0,0.5)");
      shadowGrd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius + 16, 0, 2 * Math.PI);
      ctx.fillStyle = shadowGrd;
      ctx.fill();

      // Center circle
      const centerGrd = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, innerRadius);
      centerGrd.addColorStop(0, "#1e293b");
      centerGrd.addColorStop(1, "#0f172a");
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = centerGrd;
      ctx.fill();
      ctx.strokeStyle = "rgba(6,182,212,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(6,182,212,0.8)";
      ctx.fill();

      // Pointer (top) — teardrop shape
      const pw = 11;
      const ph = 22;
      ctx.beginPath();
      ctx.moveTo(cx, 2);
      ctx.lineTo(cx - pw, ph);
      ctx.quadraticCurveTo(cx, ph - 4, cx + pw, ph);
      ctx.closePath();
      const pGrd = ctx.createLinearGradient(cx - pw, 2, cx + pw, ph);
      pGrd.addColorStop(0, "#f43f5e");
      pGrd.addColorStop(1, "#e11d48");
      ctx.fillStyle = pGrd;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    },
    [items],
  );

  // Setup HiDPI canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }, []);

  useEffect(() => {
    drawWheel(displayRotation);
  }, [drawWheel, displayRotation, items]);

  useEffect(() => {
    if (!spinning) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    let speed = 0.18;
    const animate = () => {
      rotationRef.current += speed;
      speed = Math.min(speed + 0.006, 0.32);
      setDisplayRotation(rotationRef.current);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [spinning]);

  useEffect(() => {
    if (winnerIndex === null || spinning || items.length === 0) return;
    const segAngle = (2 * Math.PI) / items.length;
    const targetAngle = 2 * Math.PI * 6 - winnerIndex * segAngle - segAngle / 2;
    const start = rotationRef.current;
    const end = start + targetAngle;
    const duration = 2400;
    const startTime = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const current = start + (end - start) * ease(t);
      rotationRef.current = current;
      setDisplayRotation(current);
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [winnerIndex, spinning, items.length]);

  if (items.length === 0) return null;

  return (
    <div className="relative flex items-center justify-center">
      {/* Glow behind wheel */}
      <div className="absolute inset-0 rounded-full bg-[rgb(var(--canton-cyan-rgb)/0.08)] blur-2xl" />
      <canvas
        ref={canvasRef}
        className="relative rounded-full drop-shadow-2xl"
        style={{ width: 320, height: 320 }}
      />
    </div>
  );
}

function RewardIcon({ rewardType, size = "sm" }: { rewardType: string; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-6 w-6" : "h-4 w-4";
  if (rewardType === "cc") return <Coins className={cn(cls, "text-yellow-400")} />;
  if (rewardType === "points") return <Star className={cn(cls, "text-purple-400")} />;
  if (rewardType === "invite_code") return <Zap className={cn(cls, "text-canton")} />;
  return <Gift className={cn(cls, "text-[var(--muted-foreground)]")} />;
}

export default function SpinRewardPage() {
  const [items, setItems] = useState<SpinItem[]>([]);
  const [state, setSpinState] = useState<SpinState | null>(null);
  const [history, setHistory] = useState<SpinHistory[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [itemsRes, stateRes, histRes] = await Promise.all([
        fetch("/api/spin/items", { credentials: "include" }),
        fetch("/api/spin/state", { credentials: "include" }),
        fetch("/api/spin/history?pageSize=5", { credentials: "include" }),
      ]);
      if (itemsRes.ok) setItems((await itemsRes.json()) as SpinItem[]);
      if (stateRes.ok) setSpinState((await stateRes.json()) as SpinState);
      if (histRes.ok) {
        const h = (await histRes.json()) as { items: SpinHistory[] };
        setHistory(h.items ?? []);
      }
    } catch {
      setError("Failed to load spin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSpin() {
    if (spinning || !state) return;
    setError(null);
    setLastResult(null);
    setWinnerIndex(null);
    setSpinning(true);

    try {
      const res = await fetch("/api/spin/execute", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as SpinResult & { message?: string };

      if (!res.ok || !data.ok) {
        setError(typeof data.message === "string" ? data.message : "Spin failed. Try again.");
        setSpinning(false);
        return;
      }

      const idx = items.findIndex((i) => i.id === data.item.id);
      setSpinning(false);
      setWinnerIndex(idx >= 0 ? idx : 0);
      setLastResult(data);

      setTimeout(() => {
        void loadData();
      }, 2800);
    } catch {
      setError("Network error. Please try again.");
      setSpinning(false);
    }
  }

  const canSpin =
    !spinning &&
    state !== null &&
    state.availablePoints >= state.spinCost &&
    items.length > 0;

  if (loading) {
    return (
      <PlatformPage>
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage>
      <div className="mx-auto w-full max-w-lg space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--canton-cyan-rgb)/0.12)] ring-1 ring-[rgb(var(--canton-cyan-rgb)/0.25)]">
            <Ticket className="h-5 w-5 text-canton" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--foreground)]">Spin &amp; Win</h1>
            <p className="text-xs text-[var(--muted-foreground)]">Use points to spin for CC rewards</p>
          </div>
        </div>

        {/* Points Balance Card */}
        {state && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                  Available Points
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--foreground)]">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1.5 text-sm font-normal text-[var(--muted-foreground)]">pts</span>
                </p>
              </div>
              <div className="rounded-xl border border-[rgb(var(--canton-cyan-rgb)/0.2)] bg-[rgb(var(--canton-cyan-rgb)/0.06)] px-4 py-2.5 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                  Cost per spin
                </p>
                <p className="mt-0.5 text-xl font-bold text-canton">
                  {state.spinCost} pts
                </p>
              </div>
            </div>
            {state.availablePoints < state.spinCost && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/8 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                <p className="text-xs font-medium text-orange-400">
                  Not enough points. Complete quests to earn more!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Spin Wheel Card */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6">
          {items.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30">
                <Gift className="h-7 w-7 text-[var(--muted-foreground)]" />
              </div>
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                No prizes configured yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <SpinWheel items={items} spinning={spinning} winnerIndex={winnerIndex} />

              {/* Result Banner */}
              {lastResult && !spinning && (
                <div className="w-full rounded-2xl border border-emerald-500/25 bg-emerald-500/8 px-5 py-3.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Trophy className="h-4 w-4 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-300">
                      {lastResult.message}
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex w-full items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/8 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-sm font-medium text-red-400">{error}</p>
                </div>
              )}

              {/* Spin Button */}
              <button
                type="button"
                onClick={() => void handleSpin()}
                disabled={!canSpin}
                className={cn(
                  "relative w-full max-w-[280px] overflow-hidden rounded-2xl px-8 py-4 text-base font-bold transition-all duration-200",
                  canSpin
                    ? "bg-gradient-to-r from-[rgb(var(--canton-cyan-rgb))] to-[#6366f1] text-white shadow-lg shadow-[rgb(var(--canton-cyan-rgb)/0.3)] hover:shadow-[rgb(var(--canton-cyan-rgb)/0.45)] hover:brightness-110 active:scale-[0.97]"
                    : "cursor-not-allowed bg-[var(--muted)]/50 text-[var(--muted-foreground)]",
                )}
              >
                {spinning ? (
                  <span className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="sm" />
                    Spinning…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Ticket className="h-4 w-4" />
                    Spin ({state?.spinCost ?? 50} pts)
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

      </div>
    </PlatformPage>
  );
}
