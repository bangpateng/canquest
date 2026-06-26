"use client";

import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/utils";

/** Renders a smooth SVG sparkline (area + line) of recent CC prices. */
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const W = 280;
  const H = 64;
  const PAD = 4;

  if (data.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-[11px] text-slate-600">
        Collecting market data…
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (H - PAD * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1]![0].toFixed(2)},${H} L${points[0]![0].toFixed(2)},${H} Z`;

  const stroke = positive ? "rgb(var(--canton-rgb))" : "#f87171";
  const fill = positive ? "rgb(var(--canton-rgb))" : "#f87171";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="cc-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.28" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cc-spark-fill)" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function CcPriceCard() {
  const t = usePlatformT();
  const { price, change24hPct, history } = useCcPrice();

  const positive = (change24hPct ?? 0) >= 0;
  const hasChange = change24hPct !== null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]"
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                {t("dashboard.ccPrice")}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--primary)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                </span>
                {t("dashboard.ccPriceLive")}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              {price === null ? (
                <span className="text-2xl font-bold tracking-tight text-slate-500">
                  {t("dashboard.priceLoading")}
                </span>
              ) : (
                <p className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight text-white">
                  ${price.toFixed(price >= 1 ? 4 : 6)}
                </p>
              )}
              {hasChange && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                    positive
                      ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                      : "bg-red-500/15 text-red-400",
                  )}
                >
                  {positive ? (
                    <TrendingUp className="h-3 w-3" aria-hidden />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden />
                  )}
                  {positive ? "+" : ""}
                  {change24hPct!.toFixed(2)}%
                  <span className="font-medium text-slate-500">{t("dashboard.change24h")}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5">
          <Sparkline data={history} positive={positive} />
        </div>

        <p className="mt-3 text-[11px] font-medium text-slate-600">
          Bybit · CCUSDT · updates every 30s
        </p>
      </div>
    </div>
  );
}
