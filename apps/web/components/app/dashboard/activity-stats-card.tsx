"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Gift, Sparkles, Zap } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export interface ActivityStatsCardProps {
  questsDone: number;
  earnDone: number;
  onchainTx: number;
  loading: boolean;
}

function Stat({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className={"flex h-10 w-10 items-center justify-center rounded-xl ring-1 " + iconBg}>
        <span className={iconColor}>{icon}</span>
      </div>
      {loading ? (
        <LoadingSpinner size="sm" tone="muted" />
      ) : (
        <p className="text-2xl font-extrabold tabular-nums tracking-tight text-white">
          {value.toLocaleString()}
        </p>
      )}
      <p className="text-[11px] font-medium leading-tight text-slate-500">{label}</p>
    </div>
  );
}

export function ActivityStatsCard({
  questsDone,
  earnDone,
  onchainTx,
  loading,
}: ActivityStatsCardProps) {
  const t = usePlatformT();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(124_58_237/0.08),transparent_70%)]"
        aria-hidden
      />
      <div className="relative">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
          {t("dashboard.recentActivity")}
        </span>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat
            icon={<Gift className="h-5 w-5" aria-hidden />}
            iconBg="bg-emerald-500/10 ring-emerald-500/20"
            iconColor="text-emerald-400"
            label={t("dashboard.questsDone")}
            value={questsDone}
            loading={loading}
          />
          <Stat
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            iconBg="bg-cyan-500/10 ring-cyan-500/20"
            iconColor="text-cyan-400"
            label={t("dashboard.earnDone")}
            value={earnDone}
            loading={loading}
          />
          <Stat
            icon={<Zap className="h-5 w-5" aria-hidden />}
            iconBg="bg-violet-500/10 ring-violet-500/20"
            iconColor="text-violet-400"
            label={t("dashboard.onchainTx")}
            value={onchainTx}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
