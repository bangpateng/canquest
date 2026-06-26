"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export interface PointsCardProps {
  totalEarned: number;
  spent: number;
  remaining: number;
  loading: boolean;
}

function SubStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={
          "mt-0.5 text-lg font-bold tabular-nums " +
          (tone === "warn" ? "text-rose-400" : "text-white")
        }
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export function PointsCard({ totalEarned, spent, remaining, loading }: PointsCardProps) {
  const t = usePlatformT();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_0%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]"
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            {t("dashboard.questPoints")}
          </span>
        </div>

        {/* Headline: remaining (net spendable) */}
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t("dashboard.pointsRemaining")}
          </p>
          {loading ? (
            <div className="mt-1 flex h-10 items-center">
              <LoadingSpinner size="lg" tone="muted" />
            </div>
          ) : (
            <p className="mt-1 text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight text-white glow-text">
              {remaining.toLocaleString()}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">{t("dashboard.pointsRemainingHint")}</p>
        </div>

        {/* Sub-stats */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <SubStat
            label={t("dashboard.pointsTotal")}
            value={totalEarned}
            tone="muted"
          />
          <SubStat
            label={t("dashboard.pointsSpent")}
            value={spent}
            tone="warn"
          />
        </div>
      </div>
    </div>
  );
}
