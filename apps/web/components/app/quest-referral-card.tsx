"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, Loader2, UserPlus } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils";

type ReferralStats = {
  referralCode: string;
  referralLink: string;
  pointsPerInvite: number;
  invitedCount: number;
  pointsEarned: number;
};

export function QuestReferralCard() {
  const t = usePlatformT();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/referral", { credentials: "include", cache: "no-store" });
      if (!res.ok) {
        setError(t("questReferral.loadError"));
        return;
      }
      setStats((await res.json()) as ReferralStats);
    } catch {
      setError(t("questReferral.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyLink() {
    if (!stats?.referralLink) return;
    try {
      await navigator.clipboard.writeText(stats.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("questReferral.copyError"));
    }
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40"
      aria-label={t("questReferral.aria")}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
          <Gift className="h-3.5 w-3.5 text-canton" aria-hidden />
          {t("questReferral.title")}
        </p>
        {stats && !loading ? (
          <span className="text-[10px] font-semibold tabular-nums text-canton">
            +{stats.pointsPerInvite} {t("questReferral.perFriend")}
          </span>
        ) : null}
      </div>

      <div className="px-4 py-4 sm:px-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin text-canton" />
            {t("common.loading")}
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : stats ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
              {t("questReferral.lead", { n: stats.pointsPerInvite })}
            </p>

            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-canton" aria-hidden />
                <span className="text-[var(--muted-foreground)]">{t("questReferral.invited")}</span>
                <span className="font-bold tabular-nums text-[var(--foreground)]">
                  {stats.invitedCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted-foreground)]">{t("questReferral.earned")}</span>
                <span className="font-bold tabular-nums text-canton">
                  {stats.pointsEarned} pts
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 font-mono text-xs tracking-wider text-[var(--foreground)]">
                {stats.referralCode}
              </code>
              <button
                type="button"
                onClick={() => void copyLink()}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-colors",
                  copied
                    ? "border border-canton-muted bg-canton-subtle text-canton"
                    : "bg-canton text-[var(--primary-foreground)] hover:opacity-90",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("common.copied") : t("questReferral.copyLink")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
