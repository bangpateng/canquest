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
  History,
  ChevronRight,
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

interface SpinHistory {
  id: string;
  item: SpinItem;
  pointsSpent: number;
  delivered: boolean;
  ledgerTxId: string | null;
  createdAt: string;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

/**
 * High-contrast alternating palette so adjacent segments are always visually
 * distinct. Each entry is [fill, darkened-edge].
 */
const PALETTE: [string, string][] = [
  ["#06b6d4", "#0891b2"], // cyan
  ["#6366f1", "#4f46e5"], // indigo
  ["#f59e0b", "#d97706"], // amber
  ["#10b981", "#059669"], // emerald
  ["#f43f5e", "#e11d48"], // rose
  ["#8b5cf6", "#7c3aed"], // violet
  ["#0ea5e9", "#0284c7"], // sky
  ["#ec4899", "#db2777"], // pink
  ["#14b8a6", "#0d9488"], // teal
  ["#a855f7", "#9333ea"], // purple
  ["#22c55e", "#16a34a"], // green
  ["#fb923c", "#ea580c"], // orange
];

function segmentColor(item: SpinItem, index: number): [string, string] {
  // If admin set a non-default color, use it; otherwise cycle palette
  const isDefault = !item.color || item.color === "#6366f1" || item.color === "#d4ff3f";
  if (!isDefault) {
    // Darken by ~15% for edge
    return [item.color, item.color + "cc"];
  }
  return PALETTE[index % PALETTE.length]!;
}

// ─── SpinWheel Component ──────────────────────────────────────────────────────

/**
 * Canvas-based spin wheel.
 *
 * Coordinate system:
 *   - Segment i occupies the arc from angle (i * segAngle) to ((i+1) * segAngle)
 *     measured from the canvas "natural" 0 (right / 3 o'clock).
 *   - We apply a global `rotation` offset so the wheel appears to spin.
 *   - The pointer is drawn OUTSIDE the canvas as a fixed SVG arrow at the top.
 *   - The pointer points straight DOWN from the top, i.e. at canvas angle = -π/2
 *     (or equivalently 3π/2). In our rotated frame, the pointer hits the segment
 *     whose mid-angle satisfies:  rotation + i*segAngle + segAngle/2 ≡ -π/2 (mod 2π)
 *
 * Winner stop formula (precise):
 *   We want segment `winnerIndex` to be centered under the pointer.
 *   The pointer is at canvas angle = -π/2.
 *   Segment i center (unrotated) = i * segAngle + segAngle / 2
 *   After rotation R: segment center is at R + i*segAngle + segAngle/2
 *   We want: R + winnerIndex*segAngle + segAngle/2 ≡ -π/2  (mod 2π)
 *   => R_target = -π/2 - winnerIndex*segAngle - segAngle/2
 *
 *   To ensure the wheel spins forward (positive direction) and does several full
 *   rotations for drama, we add enough full turns:
 *   R_final = R_current + (R_target - R_current mod 2π) + N * 2π
 *   where N is chosen so R_final > R_current + minSpins * 2π.
 */
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
  // rotationRef holds the current visual rotation in radians (accumulates)
  const rotationRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  // Trigger re-draw by updating this state
  const [displayRotation, setDisplayRotation] = useState(0);
  // Track whether we're in the "idle spin" phase vs "stop" phase
  const idleSpinRef = useRef(false);
  const idleSpeedRef = useRef(0);

  // ── Draw ──────────────────────────────────────────────────────────────────

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
      const innerR = 32;
      const segAngle = (2 * Math.PI) / items.length;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // ── Outer decorative ring ──────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, outerR + 7, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // ── Segments ──────────────────────────────────────────────────────────
      items.forEach((item, i) => {
        const [fill, edge] = segmentColor(item, i);
        const startAngle = rotation + i * segAngle;
        const endAngle = startAngle + segAngle;
        const midAngle = startAngle + segAngle / 2;

        // Radial gradient: bright at outer edge, slightly darker toward center
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

        // Crisp white separator lines
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── Label ────────────────────────────────────────────────────────────
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(midAngle);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        const maxFontSize = Math.max(8, Math.min(13, 200 / items.length));
        ctx.font = `700 ${maxFontSize}px -apple-system, system-ui, sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 5;
        ctx.fillStyle = "#ffffff";

        const maxChars = items.length > 8 ? 9 : 12;
        const label =
          item.label.length > maxChars
            ? item.label.slice(0, maxChars - 1) + "…"
            : item.label;
        ctx.fillText(label, outerR - 10, 0);
        ctx.restore();
      });

      // ── Inner shadow vignette ──────────────────────────────────────────────
      const vigGrd = ctx.createRadialGradient(cx, cy, innerR, cx, cy, innerR + 24);
      vigGrd.addColorStop(0, "rgba(0,0,0,0.55)");
      vigGrd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + 24, 0, 2 * Math.PI);
      ctx.fillStyle = vigGrd;
      ctx.fill();

      // ── Center hub ────────────────────────────────────────────────────────
      // Outer hub ring
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + 2, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();

      // Hub body
      const hubGrd = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, innerR);
      hubGrd.addColorStop(0, "#1e293b");
      hubGrd.addColorStop(1, "#0f172a");
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
      ctx.fillStyle = hubGrd;
      ctx.fill();

      // Hub border glow
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(6,182,212,0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Hub center dot
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

  // ── HiDPI setup ───────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 340;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }, []);

  // Re-draw whenever displayRotation or items change
  useEffect(() => {
    drawWheel(displayRotation);
  }, [drawWheel, displayRotation, items]);

  // ── Idle spin (while waiting for API response) ────────────────────────────

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

  // ── Stop animation (easing to winner) ────────────────────────────────────

  useEffect(() => {
    if (winnerIndex === null || spinning || items.length === 0) return;

    cancelAnimationFrame(animFrameRef.current);

    const segAngle = (2 * Math.PI) / items.length;

    /**
     * Target rotation so segment `winnerIndex` is centered under the top pointer.
     *
     * Pointer is at canvas angle = -π/2 (top of circle).
     * Segment i center (unrotated) = i * segAngle + segAngle / 2
     * We need: R + i*segAngle + segAngle/2 = -π/2  (mod 2π)
     * => R_target_base = -π/2 - winnerIndex*segAngle - segAngle/2
     */
    const targetBase = -Math.PI / 2 - winnerIndex * segAngle - segAngle / 2;

    // Normalize current rotation to [0, 2π)
    const currentNorm = ((rotationRef.current % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // Normalize target to [0, 2π)
    const targetNorm = ((targetBase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    // How much extra we need to rotate from current normalized position
    let delta = targetNorm - currentNorm;
    if (delta < 0) delta += 2 * Math.PI; // always go forward

    // Add enough full rotations for drama (minimum 5 full spins)
    const minExtraSpins = 5;
    const totalDelta = delta + minExtraSpins * 2 * Math.PI;

    const startRotation = rotationRef.current;
    const endRotation = startRotation + totalDelta;

    // Duration scales slightly with distance for natural feel
    const duration = 3200 + Math.min(totalDelta * 80, 1200);
    const startTime = performance.now();

    /**
     * Cubic ease-out: fast start, smooth deceleration.
     * t=0 → 0, t=1 → 1, derivative at t=0 is 3 (fast), at t=1 is 0 (stopped).
     */
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
        // Snap to exact final position
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

  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Ambient glow behind wheel */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 380,
          height: 380,
          background:
            "radial-gradient(circle, rgba(6,182,212,0.12) 0%, rgba(99,102,241,0.08) 50%, transparent 70%)",
          filter: "blur(24px)",
        }}
      />

      {/* Outer decorative ring */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 356,
          height: 356,
          border: "2px solid rgba(255,255,255,0.06)",
          boxShadow: "0 0 40px rgba(6,182,212,0.15), inset 0 0 40px rgba(0,0,0,0.3)",
        }}
      />

      {/* Pointer — fixed SVG arrow at top center */}
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
          {/* Teardrop pointer */}
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
          {/* Tip highlight */}
          <circle cx="14" cy="4" r="2.5" fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>

      {/* Canvas wheel */}
      <canvas
        ref={canvasRef}
        className="relative rounded-full"
        style={{
          width: 340,
          height: 340,
          boxShadow:
            "0 25px 60px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,255,255,0.06), 0 0 80px rgba(6,182,212,0.1)",
        }}
      />
    </div>
  );
}

// ─── Reward Icon ──────────────────────────────────────────────────────────────

function RewardIcon({ rewardType, size = "sm" }: { rewardType: string; size?: "sm" | "md" | "lg" }) {
  const cls =
    size === "lg" ? "h-8 w-8" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  if (rewardType === "cc") return <Coins className={cn(cls, "text-amber-400")} />;
  if (rewardType === "points") return <Star className={cn(cls, "text-violet-400")} />;
  if (rewardType === "invite_code") return <Zap className={cn(cls, "text-cyan-400")} />;
  return <Gift className={cn(cls, "text-slate-400")} />;
}

// ─── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: SpinHistory }) {
  const date = new Date(entry.createdAt);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
        <RewardIcon rewardType={entry.item.rewardType} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-200">{entry.item.label}</p>
        <p className="text-xs text-slate-500">
          {dateStr} · {timeStr} · {entry.pointsSpent} pts
        </p>
      </div>
      <div className="shrink-0">
        {entry.delivered ? (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            Delivered
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Pending
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Prize Legend ─────────────────────────────────────────────────────────────

function PrizeLegend({ items }: { items: SpinItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((item, i) => {
        const [fill] = segmentColor(item, i);
        return (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5"
          >
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ backgroundColor: fill }}
            />
            <span className="truncate text-xs font-medium text-slate-300">{item.label}</span>
            <span className="ml-auto shrink-0 text-[10px] font-semibold text-slate-500">
              {item.probability}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SpinRewardPage() {
  const [items, setItems] = useState<SpinItem[]>([]);
  const [state, setSpinState] = useState<SpinState | null>(null);
  const [history, setHistory] = useState<SpinHistory[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResult, setShowResult] = useState(false);

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

      // Find winner index in the items array
      const idx = items.findIndex((i) => i.id === data.item.id);

      // Stop idle spin, then trigger the stop animation
      setSpinning(false);
      setWinnerIndex(idx >= 0 ? idx : 0);
      setLastResult(data);
    } catch {
      setError("Network error. Please try again.");
      setSpinning(false);
    }
  }

  // Called when the stop animation finishes
  function handleSpinComplete() {
    setShowResult(true);
    // Refresh data after a short delay
    setTimeout(() => {
      void loadData();
    }, 1500);
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
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(99,102,241,0.2) 100%)",
              boxShadow: "0 0 0 1px rgba(6,182,212,0.25), 0 4px 16px rgba(6,182,212,0.1)",
            }}
          >
            <Ticket className="h-6 w-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Lucky Spin
            </h1>
            <p className="text-sm text-slate-400">
              Spend points for a chance to win CC &amp; bonus rewards
            </p>
          </div>
          {state && (
            <div className="ml-auto hidden sm:block">
              <div
                className="rounded-xl px-4 py-2 text-right"
                style={{
                  background: "rgba(6,182,212,0.06)",
                  border: "1px solid rgba(6,182,212,0.18)",
                }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Balance
                </p>
                <p className="text-lg font-bold tabular-nums text-slate-100">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-slate-400">pts</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Main Spin Card ───────────────────────────────────────────────── */}
        <div
          className="overflow-hidden rounded-3xl"
          style={{
            background: "linear-gradient(160deg, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.98) 100%)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          {items.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <Gift className="h-8 w-8 text-slate-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-300">No prizes configured</p>
                <p className="mt-1 text-sm text-slate-500">Check back soon — prizes are being set up!</p>
              </div>
            </div>
          ) : (
            <>
              {/* Wheel area */}
              <div
                className="flex flex-col items-center gap-6 px-6 py-8"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 0%, rgba(6,182,212,0.06) 0%, transparent 60%)",
                }}
              >
                <SpinWheel
                  items={items}
                  spinning={spinning}
                  winnerIndex={winnerIndex}
                  onSpinComplete={handleSpinComplete}
                />

                {/* Result banner — shown after animation completes */}
                {showResult && lastResult && (
                  <div
                    className="w-full max-w-sm overflow-hidden rounded-2xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,182,212,0.08) 100%)",
                      border: "1px solid rgba(16,185,129,0.25)",
                      boxShadow: "0 8px 32px rgba(16,185,129,0.1)",
                    }}
                  >
                    <div className="flex items-center gap-3 px-5 py-4">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: "rgba(16,185,129,0.15)" }}
                      >
                        <Trophy className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500">
                          You won!
                        </p>
                        <p className="mt-0.5 truncate text-sm font-bold text-slate-100">
                          {lastResult.item.label}
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 shrink-0 text-emerald-400" />
                    </div>
                    <div
                      className="border-t px-5 py-2.5"
                      style={{ borderColor: "rgba(16,185,129,0.15)" }}
                    >
                      <p className="text-xs text-slate-400">{lastResult.message}</p>
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div
                    className="flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.2)",
                    }}
                  >
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
                      "group relative w-full overflow-hidden rounded-2xl px-8 py-4 text-base font-bold transition-all duration-300",
                      canSpin
                        ? "text-white"
                        : "cursor-not-allowed opacity-50",
                    )}
                    style={
                      canSpin
                        ? {
                            background:
                              "linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%)",
                            boxShadow:
                              "0 8px 32px rgba(6,182,212,0.35), 0 0 0 1px rgba(255,255,255,0.1)",
                          }
                        : {
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.3)",
                          }
                    }
                  >
                    {/* Shimmer effect on hover */}
                    {canSpin && (
                      <span
                        className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 bg-white/10 transition-transform duration-700 group-hover:translate-x-full"
                        aria-hidden
                      />
                    )}
                    {spinning ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <LoadingSpinner size="sm" />
                        <span>Spinning…</span>
                      </span>
                    ) : winnerIndex !== null && !showResult ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <LoadingSpinner size="sm" />
                        <span>Revealing…</span>
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2.5">
                        <Ticket className="h-5 w-5" />
                        <span>Spin Now</span>
                        {state && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{ background: "rgba(0,0,0,0.25)" }}
                          >
                            {state.spinCost} pts
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                  {/* Insufficient points warning */}
                  {state && state.availablePoints < state.spinCost && !spinning && (
                    <div
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5"
                      style={{
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.2)",
                      }}
                    >
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <p className="text-xs font-medium text-amber-400">
                        Need {state.spinCost} pts · You have {state.availablePoints} pts.
                        Complete quests to earn more!
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

              {/* Prize legend */}
              <div className="px-6 py-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Prize Pool
                </p>
                <PrizeLegend items={items} />
              </div>
            </>
          )}
        </div>

        {/* ── Points Balance (mobile) ──────────────────────────────────────── */}
        {state && (
          <div
            className="sm:hidden rounded-2xl px-5 py-4"
            style={{
              background: "rgba(15,23,42,0.8)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Available Points
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-100">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-slate-400">pts</span>
                </p>
              </div>
              <div
                className="rounded-xl px-3 py-2 text-right"
                style={{
                  background: "rgba(6,182,212,0.06)",
                  border: "1px solid rgba(6,182,212,0.15)",
                }}
              >
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

        {/* ── Spin History ─────────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div
            className="rounded-2xl"
            style={{
              background: "rgba(15,23,42,0.8)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-300">Recent Spins</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </div>
            <div className="divide-y px-5" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {history.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}

      </div>
    </PlatformPage>
  );
}
