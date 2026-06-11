"use client";

import { PlatformPage } from "@/components/platform/platform-page";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Ticket,
  Gift,
  Coins,
  Star,
  AlertCircle,
  Trophy,
  Zap,
  Sparkles,
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Palette ──────────────────────────────────────────────────────────────────

const PALETTE: [string, string][] = [
  ["#06b6d4", "#0891b2"],
  ["#6366f1", "#4f46e5"],
  ["#f59e0b", "#d97706"],
  ["#10b981", "#059669"],
  ["#f43f5e", "#e11d48"],
  ["#8b5cf6", "#7c3aed"],
  ["#0ea5e9", "#0284c7"],
  ["#ec4899", "#db2777"],
  ["#14b8a6", "#0d9488"],
  ["#a855f7", "#9333ea"],
  ["#22c55e", "#16a34a"],
  ["#fb923c", "#ea580c"],
];

function segmentColor(item: SpinItem, index: number): [string, string] {
  const isDefault = !item.color || item.color === "#6366f1" || item.color === "#d4ff3f";
  if (!isDefault) {
    return [item.color, item.color + "cc"];
  }
  return PALETTE[index % PALETTE.length]!;
}

// ─── SpinWheel Component ──────────────────────────────────────────────────────

function SpinWheel({
  items,
  spinning,
  winnerIndex,
  onSpinComplete,
}: {
  items: SpinItem[];
  spinning: boolean;
  winnerIndex: number | null;
  onSpinComplete?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const [displayRotation, setDisplayRotation] = useState(0);
  const idleSpinRef = useRef(false);
  const idleSpeedRef = useRef(0);
  // Responsive size: max 340px desktop, scaled down on mobile
  const [wheelSize, setWheelSize] = useState(340);

  // Update wheel size responsively
  useEffect(() => {
    function update() {
      const maxW = Math.min(340, window.innerWidth - 48);
      setWheelSize(maxW);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
      const outerR = size / 2 - 8;
      const innerR = Math.max(22, size * 0.094);
      const segAngle = (2 * Math.PI) / items.length;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Outer decorative ring
      ctx.beginPath();
      ctx.arc(cx, cy, outerR + 7, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Segments
      items.forEach((item, i) => {
        const [fill, edge] = segmentColor(item, i);
        const startAngle = rotation + i * segAngle;
        const endAngle = startAngle + segAngle;
        const midAngle = startAngle + segAngle / 2;

        const gx1 = cx + outerR * 0.85 * Math.cos(midAngle);
        const gy1 = cy + outerR * 0.85 * Math.sin(midAngle);
        const gx2 = cx + innerR * Math.cos(midAngle);
        const gy2 = cy + innerR * Math.sin(midAngle);
        const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        grad.addColorStop(0, fill);
        grad.addColorStop(1, edge);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(midAngle);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const maxFontSize = Math.max(7, Math.min(13, 180 / items.length));
        ctx.font = `700 ${maxFontSize}px -apple-system, system-ui, sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 5;
        ctx.fillStyle = "#ffffff";
        const maxChars = items.length > 8 ? 9 : 12;
        const label =
          item.label.length > maxChars
            ? item.label.slice(0, maxChars - 1) + "\u2026"
            : item.label;
        ctx.fillText(label, outerR - 8, 0);
        ctx.restore();
      });

      // Inner shadow vignette
      const vigGrd = ctx.createRadialGradient(cx, cy, innerR, cx, cy, innerR + 24);
      vigGrd.addColorStop(0, "rgba(0,0,0,0.55)");
      vigGrd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + 24, 0, 2 * Math.PI);
      ctx.fillStyle = vigGrd;
      ctx.fill();

      // Center hub
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + 2, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();

      const hubGrd = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, innerR);
      hubGrd.addColorStop(0, "#1e293b");
      hubGrd.addColorStop(1, "#0f172a");
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
      ctx.fillStyle = hubGrd;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(6,182,212,0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      const dotGrd = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 7);
      dotGrd.addColorStop(0, "#22d3ee");
      dotGrd.addColorStop(1, "#0891b2");
      ctx.fillStyle = dotGrd;
      ctx.fill();

      ctx.restore();
    },
    [items],
  );

  // HiDPI setup using responsive wheelSize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = wheelSize * dpr;
    canvas.height = wheelSize * dpr;
  }, [wheelSize]);

  useEffect(() => {
    drawWheel(displayRotation);
  }, [drawWheel, displayRotation, items, wheelSize]);

  useEffect(() => {
    if (!spinning) {
      idleSpinRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    idleSpinRef.current = true;
    idleSpeedRef.current = 0.04;

    const accelerate = () => {
      if (!idleSpinRef.current) return;
      idleSpeedRef.current = Math.min(idleSpeedRef.current + 0.004, 0.22);
      rotationRef.current += idleSpeedRef.current;
      setDisplayRotation(rotationRef.current);
      animFrameRef.current = requestAnimationFrame(accelerate);
    };

    animFrameRef.current = requestAnimationFrame(accelerate);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [spinning]);

  useEffect(() => {
    if (winnerIndex === null || spinning || items.length === 0) return;

    cancelAnimationFrame(animFrameRef.current);

    const segAngle = (2 * Math.PI) / items.length;
    const targetBase = -Math.PI / 2 - winnerIndex * segAngle - segAngle / 2;

    const currentNorm = ((rotationRef.current % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const targetNorm = ((targetBase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    let delta = targetNorm - currentNorm;
    if (delta < 0) delta += 2 * Math.PI;

    const minExtraSpins = 5;
    const totalDelta = delta + minExtraSpins * 2 * Math.PI;

    const startRotation = rotationRef.current;
    const endRotation = startRotation + totalDelta;
    const duration = 3200 + Math.min(totalDelta * 80, 1200);
    const startTime = performance.now();

    const easeOut = (t: number): number => 1 - Math.pow(1 - t, 4);

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOut(t);
      const current = startRotation + totalDelta * eased;

      rotationRef.current = current;
      setDisplayRotation(current);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        rotationRef.current = endRotation;
        setDisplayRotation(endRotation);
        onSpinComplete?.();
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerIndex, items.length]);

  if (items.length === 0) return null;

  // Calculate proportional glow & ring sizes
  const glowSize = wheelSize + 40;
  const ringSize = wheelSize + 16;
  const glowBlur = Math.max(12, wheelSize * 0.07);

  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: glowSize,
          height: glowSize,
          background: "radial-gradient(circle, rgba(6,182,212,0.12) 0%, rgba(99,102,241,0.08) 50%, transparent 70%)",
          filter: `blur(${glowBlur}px)`,
        }}
      />

      {/* Outer decorative ring */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: ringSize,
          height: ringSize,
          border: "2px solid rgba(255,255,255,0.06)",
          boxShadow: "0 0 40px rgba(6,182,212,0.15), inset 0 0 40px rgba(0,0,0,0.3)",
        }}
      />

      {/* Pointer */}
      <div
        className="pointer-events-none absolute z-10"
        style={{ top: -2, left: "50%", transform: "translateX(-50%)" }}
      >
        <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
          <defs>
            <linearGradient id="ptr-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="100%" stopColor="#be123c" />
            </linearGradient>
            <filter id="ptr-shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#f43f5e" floodOpacity="0.5" />
            </filter>
          </defs>
          <path
            d="M14 2 L3 28 Q14 22 25 28 Z"
            fill="url(#ptr-grad)"
            filter="url(#ptr-shadow)"
          />
          <path
            d="M14 2 L3 28 Q14 22 25 28 Z"
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
          />
          <circle cx="14" cy="4" r="2.5" fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>

      {/* Canvas wheel */}
      <canvas
        ref={canvasRef}
        className="relative rounded-full"
        style={{
          width: wheelSize,
          height: wheelSize,
          boxShadow:
            "0 25px 60px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,255,255,0.06), 0 0 80px rgba(6,182,212,0.1)",
        }}
      />
    </div>
  );
}

// ─── Reward Icon ──────────────────────────────────────────────────────────────

function RewardIcon({ rewardType, size = "sm" }: { rewardType: string; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-5 w-5" : "h-4 w-4";
  if (rewardType === "cc") return <Coins className={cn(cls, "text-amber-400")} />;
  if (rewardType === "points") return <Star className={cn(cls, "text-violet-400")} />;
  if (rewardType === "invite_code") return <Zap className={cn(cls, "text-cyan-400")} />;
  return <Gift className={cn(cls, "text-slate-400")} />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SpinRewardPage() {
  const [items, setItems] = useState<SpinItem[]>([]);
  const [state, setSpinState] = useState<SpinState | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResult, setShowResult] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [itemsRes, stateRes] = await Promise.all([
        fetch("/api/spin/items", { credentials: "include" }),
        fetch("/api/spin/state", { credentials: "include" }),
      ]);
      if (itemsRes.ok) setItems((await itemsRes.json()) as SpinItem[]);
      if (stateRes.ok) setSpinState((await stateRes.json()) as SpinState);
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
    setShowResult(false);
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
    } catch {
      setError("Network error. Please try again.");
      setSpinning(false);
    }
  }

  function handleSpinComplete() {
    setShowResult(true);
    void loadData();
  }

  const canSpin =
    !spinning &&
    (winnerIndex === null || showResult) &&
    state !== null &&
    state.availablePoints >= state.spinCost &&
    items.length > 0;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <PlatformPage>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-2 border-cyan-500/20 bg-cyan-500/5" />
              <LoadingSpinner size="lg" className="absolute inset-0 m-auto" />
            </div>
            <p className="text-sm font-medium text-slate-400">Loading spin wheel…</p>
          </div>
        </div>
      </PlatformPage>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PlatformPage>
      <div className="mx-auto w-full max-w-2xl space-y-5">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <div>
            <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
              Lucky Spin
            </span>
          </div>
          {state && (
            <div className="ml-auto hidden sm:block">
              <div className="rounded-xl px-4 py-2 text-right border border-cyan-500/15 bg-cyan-500/[0.04] backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Balance
                </p>
                <p className="text-lg font-bold tabular-nums text-white">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-slate-400">pts</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Main Spin Card ───────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50">
          {items.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                <Gift className="h-8 w-8 text-slate-500" />
              </div>
              <div>
                <p className="font-semibold text-white">Create a wallet to spin</p>
                <p className="mt-1 text-sm text-slate-500">
                  You need a wallet before you can spin. Create one on the Wallet page.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Wheel area */}
              <div
                className="flex flex-col items-center gap-5 px-4 py-6 sm:gap-6 sm:px-6 sm:py-8"
                style={{
                  background: "radial-gradient(ellipse at 50% 0%, rgba(6,182,212,0.05) 0%, transparent 60%)",
                }}
              >
                <SpinWheel
                  items={items}
                  spinning={spinning}
                  winnerIndex={winnerIndex}
                  onSpinComplete={handleSpinComplete}
                />

                {/* Result banner */}
                {showResult && lastResult && (
                  <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] backdrop-blur-xl">
                    <div className="flex items-center gap-3 px-5 py-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/20">
                        <Trophy className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                          You won!
                        </p>
                        <p className="mt-0.5 truncate text-sm font-bold text-white">
                          {lastResult.item.label}
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 shrink-0 text-emerald-400" />
                    </div>
                    <div className="border-t border-emerald-500/10 px-5 py-2.5">
                      <p className="text-xs text-slate-400">{lastResult.message}</p>
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex w-full max-w-sm items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 backdrop-blur-xl">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <p className="text-sm font-medium text-red-400">{error}</p>
                  </div>
                )}

                {/* Spin Button */}
                <div className="flex w-full max-w-sm flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSpin()}
                    disabled={!canSpin}
                    className={cn(
                      "group relative w-full overflow-hidden rounded-2xl px-8 py-4 text-base font-semibold transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050508]",
                      "disabled:pointer-events-none disabled:opacity-50",
                      canSpin
                        ? "bg-emerald-500 text-white hover:bg-emerald-400 hover:shadow-[0_0_30px_rgb(16_185_129/0.3)] active:bg-emerald-600"
                        : "bg-emerald-500/80 text-white",
                    )}
                  >
                    {canSpin && (
                      <span
                        className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 bg-white/10 transition-transform duration-700 group-hover:translate-x-full"
                        aria-hidden
                      />
                    )}
                    {spinning ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <LoadingSpinner size="sm" tone="inherit" />
                        <span>Spinning…</span>
                      </span>
                    ) : winnerIndex !== null && !showResult ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <LoadingSpinner size="sm" tone="inherit" />
                        <span>Revealing…</span>
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2.5">
                        <Ticket className="h-5 w-5" />
                        <span>Spin Now</span>
                        {state && (
                          <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold">
                            {state.spinCost} pts
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Points Balance (mobile) ────────────────────────────────────── */}
        {state && (
          <div className="sm:hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Available Points
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-slate-400">pts</span>
                </p>
              </div>
              <div className="rounded-xl px-3 py-2 text-right border border-cyan-500/15 bg-cyan-500/[0.04]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Cost / spin
                </p>
                <p className="mt-0.5 text-lg font-bold text-cyan-400">
                  {state.spinCost} pts
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </PlatformPage>
  );
}