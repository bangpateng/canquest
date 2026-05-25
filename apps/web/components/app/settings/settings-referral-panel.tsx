"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, Loader2, Users } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils";

type ReferralStats = {
  referralCode: string;
  referralLink: string;
  pointsPerInvite: number;
  invitedCount: number;
  pointsEarned: number;
};

export function SettingsReferralPanel() {
  const t = usePlatformT();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/referral", { credentials: "include" });
      if (!res.ok) {
        setError(t.settings.referralLoadError);
        return;
      }
      const data = (await res.json()) as ReferralStats;
      setStats(data);
    } catch {
      setError(t.settings.referralLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.settings.referralLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyText(value: string, kind: "link" | "code") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(t.settings.referralCopyError);
    }
  }

  return (
    <section
      id="referral"
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/60 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canton-subtle text-canton">
          <Gift className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="type-section-title">{t.settings.referralTitle}</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t.settings.referralLead}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.common.loading}
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      ) : stats ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                {t.settings.referralInvited}
              </p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-bold tabular-nums">
                <Users className="h-5 w-5 text-canton" aria-hidden />
                {stats.invitedCount}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                {t.settings.referralPointsEarned}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-canton">
                {stats.pointsEarned} pts
              </p>
            </div>
          </div>

          <p className="text-sm text-[var(--muted-foreground)]">
            {t.settings.referralRewardHint.replace("{n}", String(stats.pointsPerInvite))}
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {t.settings.referralCodeLabel}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2 font-mono text-sm tracking-wider">
                {stats.referralCode}
              </code>
              <button
                type="button"
                onClick={() => void copyText(stats.referralCode, "code")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--muted)]",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "code" ? t.settings.referralCopied : t.settings.referralCopyCode}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {t.settings.referralLinkLabel}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={stats.referralLink}
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--foreground)]"
              />
              <button
                type="button"
                onClick={() => void copyText(stats.referralLink, "link")}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-canton px-4 py-2 text-xs font-bold text-[var(--primary-foreground)]",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "link" ? t.settings.referralCopied : t.settings.referralCopyLink}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
