"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Card } from "@/components/ui/card";
import { Activity } from "lucide-react";

export interface ActivityStatsCardProps {
  questsDone: number;
  earnDone: number;
  onchainTx: number;
  loading: boolean;
}

function Stat({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: number;
  loading: boolean;
  accent: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-[var(--muted)]/50 px-3 py-3 ring-1 ring-[var(--border)]">
      {loading ? (
        <div className="flex h-7 items-center">
          <LoadingSpinner size="sm" tone="muted" />
        </div>
      ) : (
        <p className={`text-xl font-extrabold tabular-nums tracking-tight ${accent}`}>
          {value.toLocaleString()}
        </p>
      )}
      <p className="text-[10px] font-medium uppercase tracking-wide leading-tight text-[var(--muted-foreground)]">
        {label}
      </p>
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
    <Card interactive className="relative overflow-hidden p-6 sm:p-7">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgb(32 211 195 / 0.10), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative">
        {/* Icon + label */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/15">
            <Activity className="h-4 w-4 text-canton" aria-hidden />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("dashboard.recentActivity")}
          </p>
        </div>

        {/* Stat grid */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <Stat
            label={t("dashboard.questsDone")}
            value={questsDone}
            loading={loading}
            accent="text-[var(--foreground)]"
          />
          <Stat
            label={t("dashboard.earnDone")}
            value={earnDone}
            loading={loading}
            accent="text-canton"
          />
          <Stat
            label={t("dashboard.onchainTx")}
            value={onchainTx}
            loading={loading}
            accent="text-[var(--foreground)]"
          />
        </div>
      </div>
    </Card>
  );
}
