"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Gift, Loader2, Sparkles, Trophy } from "lucide-react";

type SpinItem = {
  id: string;
  label: string;
  rewardType: string;
  rewardCc: number;
  rewardPoints: number;
  probability: number;
  color: string;
};

type SpinState = {
  spinCost: number;
  earnPoints: number;
  spentPoints: number;
  availablePoints: number;
};

type SpinHistoryRow = {
  id: string;
  item: SpinItem;
  pointsSpent: number;
  delivered: boolean;
  createdAt: string;
};

type ExecuteResponse = {
  ok?: boolean;
  message?: string;
  item?: SpinItem;
  pointsSpent?: number;
};

const FETCH_TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.message === "string" ? data.message : `Request failed (${res.status})`,
    );
  }
  return data;
}

function formatReward(item: SpinItem): string {
  if (item.rewardType === "cc" && item.rewardCc > 0) return `${item.rewardCc} CC`;
  if (item.rewardType === "points" && item.rewardPoints > 0) {
    return `+${item.rewardPoints} pts`;
  }
  return item.label;
}

export function SpinRewardView() {
  const t = usePlatformT();
  const [items, setItems] = useState<SpinItem[]>([]);
  const [state, setState] = useState<SpinState | null>(null);
  const [history, setHistory] = useState<SpinHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [itemsRes, stateRes, historyRes] = await Promise.all([
        fetchJson<SpinItem[]>("/api/spin/items"),
        fetchJson<SpinState>("/api/spin/state"),
        fetchJson<{ items: SpinHistoryRow[] }>("/api/spin/history?page=1&pageSize=8"),
      ]);
      setItems(itemsRes);
      setState(stateRes);
      setHistory(historyRes.items ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("spin.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const spinCost = state?.spinCost ?? 50;
  const available = state?.availablePoints ?? 0;
  const canSpin = available >= spinCost && items.length > 0 && !spinning;

  const wheelGradient = useMemo(() => {
    if (items.length === 0) return "conic-gradient(#333 0deg 360deg)";
    const slice = 360 / items.length;
    const stops = items
      .map((item, i) => {
        const start = i * slice;
        const end = (i + 1) * slice;
        return `${item.color || "#d4ff3f"} ${start}deg ${end}deg`;
      })
      .join(", ");
    return `conic-gradient(from -90deg, ${stops})`;
  }, [items]);

  const runSpin = async () => {
    if (!canSpin) return;
    setSpinning(true);
    setActionError(null);
    setLastMessage(null);

    try {
      const result = await fetchJson<ExecuteResponse>("/api/spin/execute", {
        method: "POST",
      });
      const winner = result.item;
      if (!winner) throw new Error(t("spin.loadError"));

      const idx = items.findIndex((i) => i.id === winner.id);
      const safeIdx = idx >= 0 ? idx : 0;
      const slice = 360 / items.length;
      const targetAngle = 360 - (safeIdx * slice + slice / 2);
      const extraTurns = 5 * 360;
      setWheelRotation((prev) => {
        const base = prev % 360;
        return prev - base + extraTurns + targetAngle;
      });

      window.setTimeout(() => {
        setLastMessage(result.message ?? formatReward(winner));
        setSpinning(false);
        void loadAll();
      }, 4200);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("spin.loadError"));
      setSpinning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-6 text-center text-sm text-orange-200">
        <p>{loadError}</p>
        <button
          type="button"
          className="mt-3 font-semibold underline"
          onClick={() => {
            setLoading(true);
            void loadAll();
          }}
        >
          {t("spin.retry")}
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="glass-card rounded-2xl border border-[var(--border)] p-8 text-center">
        <Gift className="mx-auto h-10 w-10 text-[var(--muted-foreground)]" />
        <p className="mt-3 font-medium">{t("spin.noItems")}</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("spin.noItemsHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr,300px]">
        <div className="glass-card rounded-2xl border border-[var(--border)] p-6 md:p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div
                className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1"
                aria-hidden
              >
                <div className="h-0 w-0 border-x-[10px] border-x-transparent border-b-[16px] border-b-[var(--primary)]" />
              </div>
              <div
                className={cn(
                  "relative h-56 w-56 rounded-full border-4 border-[var(--border)] shadow-[inset_0_0_40px_rgb(0_0_0_/_25%)] transition-transform duration-[4000ms] ease-out",
                  spinning && "duration-[4000ms]",
                )}
                style={{
                  background: wheelGradient,
                  transform: `rotate(${wheelRotation}deg)`,
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-[var(--primary)]/30 bg-[var(--card)] shadow-lg">
                    <Sparkles className="h-8 w-8 text-[var(--primary)]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full max-w-sm space-y-2 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">
                {t("spin.pointsAvailable", { n: available.toLocaleString() })}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {t("spin.spinCost", { n: spinCost.toLocaleString() })}
              </p>
              <button
                type="button"
                disabled={!canSpin}
                onClick={() => void runSpin()}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                {spinning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("spin.spinning")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t("spin.spinNow")}
                  </>
                )}
              </button>
            </div>

            {actionError ? (
              <p className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
                {actionError}
              </p>
            ) : null}

            {lastMessage ? (
              <p className="w-full rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-4 py-3 text-center text-sm font-medium text-[var(--foreground)]">
                {lastMessage}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="glass-card rounded-2xl border border-[var(--border)] p-6">
          <h3 className="type-card-title flex items-center gap-2">
            <Trophy className="h-4 w-4 text-canton" />
            {t("spin.rewardsPool")}
          </h3>
          <ul className="mt-4 max-h-[320px] space-y-2 overflow-y-auto text-sm">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color || "#d4ff3f" }}
                  />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
                  {row.probability}%
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="glass-card rounded-2xl border border-[var(--border)] p-6">
        <h3 className="type-card-title">{t("spin.history")}</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">{t("spin.historyEmpty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)] text-sm">
            {history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{row.item.label}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {t("spin.pointsSpent", { n: row.pointsSpent })}
                    {" · "}
                    {formatReward(row.item)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    row.delivered
                      ? "bg-green-500/15 text-green-600 dark:text-green-400"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {row.delivered ? t("spin.statusDelivered") : t("spin.statusPending")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
