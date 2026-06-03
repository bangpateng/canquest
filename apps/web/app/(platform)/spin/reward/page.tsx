"use client";

import { PlatformPage } from "@/components/platform/platform-page";
import { useEffect, useState, useCallback, useRef } from "react";
import { Ticket, RefreshCw, Gift, Coins, Star, AlertCircle } from "lucide-react";
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

const SEGMENT_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
  "#f43f5e", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
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

      const size = canvas.width;
      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 4;
      const segAngle = (2 * Math.PI) / items.length;

      ctx.clearRect(0, 0, size, size);

      items.forEach((item, i) => {
        const startAngle = rotation + i * segAngle - Math.PI / 2;
        const endAngle = startAngle + segAngle;

        // Segment
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? "#6366f1";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + segAngle / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(9, Math.min(13, 200 / items.length))}px sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 3;
        const label =
          item.label.length > 12 ? item.label.slice(0, 11) + "…" : item.label;
        ctx.fillText(label, radius - 10, 4);
        ctx.restore();
      });

      // Center circle
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, 2 * Math.PI);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Pointer (top)
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx - 10, 22);
      ctx.lineTo(cx + 10, 22);
      ctx.closePath();
      ctx.fillStyle = "#f43f5e";
      ctx.fill();
    },
    [items],
  );

  useEffect(() => {
    drawWheel(displayRotation);
  }, [drawWheel, displayRotation, items]);

  useEffect(() => {
    if (!spinning) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let speed = 0.25;
    const animate = () => {
      rotationRef.current += speed;
      speed = Math.min(speed + 0.008, 0.35);
      setDisplayRotation(rotationRef.current);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [spinning]);

  useEffect(() => {
    if (winnerIndex === null || spinning || items.length === 0) return;
    const segAngle = (2 * Math.PI) / items.length;
    const targetAngle =
      2 * Math.PI * 5 - winnerIndex * segAngle - segAngle / 2;
    const start = rotationRef.current;
    const end = start + targetAngle;
    const duration = 2000;
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
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        className="rounded-full shadow-2xl shadow-black/60 ring-2 ring-white/10"
      />
    </div>
  );
}

function RewardIcon({ rewardType }: { rewardType: string }) {
  if (rewardType === "cc") return <Coins className="h-5 w-5 text-yellow-400" />;
  if (rewardType === "points") return <Star className="h-5 w-5 text-purple-400" />;
  return <Gift className="h-5 w-5 text-slate-400" />;
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
        setError(
          typeof data.message === "string"
            ? data.message
            : "Spin failed. Try again.",
        );
        setSpinning(false);
        return;
      }

      // Find winner index in items list
      const idx = items.findIndex((i) => i.id === data.item.id);
      setSpinning(false);
      setWinnerIndex(idx >= 0 ? idx : 0);
      setLastResult(data);

      // Refresh state after 2.5s
      setTimeout(() => {
        void loadData();
      }, 2500);
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
      <div className="w-full max-w-full space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 ring-1 ring-purple-500/20">
            <Ticket className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Spin &amp; Win</h1>
            <p className="text-xs text-slate-400">Use points to spin for CC rewards</p>
          </div>
        </div>

        {/* Points Balance */}
        {state && (
          <div className="rounded-2xl border border-white/5 bg-slate-900/40 px-5 py-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Available Points
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-white">
                  {state.availablePoints.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-slate-400">pts</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-slate-400">Cost per spin</p>
                <p className="mt-1 text-lg font-bold text-purple-400">
                  {state.spinCost} pts
                </p>
              </div>
            </div>
            {state.availablePoints < state.spinCost && (
              <p className="mt-3 text-xs font-medium text-orange-400">
                ⚠️ Not enough points. Complete quests to earn more!
              </p>
            )}
          </div>
        )}

        {/* Spin Wheel + Button */}
        <div className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 backdrop-blur-xl shadow-2xl shadow-black/40">
          {items.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
              <Gift className="h-10 w-10 text-slate-500" />
              <p className="text-sm font-medium text-slate-400">
                No spin items configured yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6">
              <SpinWheel
                items={items}
                spinning={spinning}
                winnerIndex={winnerIndex}
              />

              {/* Result Banner */}
              {lastResult && !spinning && (
                <div className="w-full rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-4 text-center">
                  <p className="text-sm font-semibold text-green-300">
                    🎉 {lastResult.message}
                  </p>
                </div>
              )}

              {error && (
                <div className="flex w-full items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-sm font-medium text-red-400">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleSpin()}
                disabled={!canSpin}
                className={cn(
                  "w-full max-w-xs rounded-2xl px-8 py-4 text-base font-bold transition-all duration-200",
                  canSpin
                    ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25 hover:from-purple-500 hover:to-pink-500 active:scale-[0.98]"
                    : "cursor-not-allowed bg-slate-700/50 text-slate-500",
                )}
              >
                {spinning ? (
                  <span className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="sm" />
                    Spinning…
                  </span>
                ) : (
                  `Spin (${state?.spinCost ?? 50} pts)`
                )}
              </button>
            </div>
          )}
        </div>

        {/* Prizes List */}
        {items.length > 0 && (
          <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Prizes
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((item, i) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
                >
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                    }}
                  />
                  <RewardIcon rewardType={item.rewardType} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-200">
                      {item.label}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {item.probability}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Recent Spins
              </h2>
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <RewardIcon rewardType={h.item.rewardType} />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {h.item.label}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        -{h.pointsSpent} pts ·{" "}
                        {new Date(h.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      h.delivered
                        ? "bg-green-500/10 text-green-400"
                        : "bg-orange-500/10 text-orange-400",
                    )}
                  >
                    {h.delivered ? "Delivered" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PlatformPage>
  );
}
