"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export interface PointsCardProps {
  /** Saldo tersedia (sisa) = total earned - spent di Earn events. */
  remaining: number;
  loading: boolean;
}

export function PointsCard({ remaining, loading }: PointsCardProps) {
  const t = usePlatformT();

  return (
    <Card interactive className="overflow-hidden p-6 sm:p-7">
      <div>
        {/* Icon + label */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10">
            <Sparkles className="h-4 w-4 text-canton" aria-hidden />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("dashboard.questPoints")}
          </p>
        </div>

        {/* Headline number */}
        <div className="mt-5">
          {loading ? (
            <div className="flex h-12 items-center">
              <LoadingSpinner size="lg" tone="muted" />
            </div>
          ) : (
            <p className="text-4xl font-extrabold tabular-nums tracking-tight text-[var(--foreground)] glow-text">
              {remaining.toLocaleString()}
            </p>
          )}
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
            {t("dashboard.pointsRemainingHint")}
          </p>
        </div>
      </div>
    </Card>
  );
}
