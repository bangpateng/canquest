"use client";
import { InlineLoading } from "@/components/ui/loading-spinner";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, UserPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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
          <Gift className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
          {t("questReferral.title")}
        </p>
        {stats && !loading ? (
          <span className="text-xs font-semibold tabular-nums text-emerald-400/90">
            +{stats.pointsPerInvite} {t("questReferral.perFriend")}
          </span>
        ) : null}
      </div>

      <div className="px-4 py-4 sm:px-5">
        {loading ? (
          <InlineLoading label={t("common.loading")} size="md" />
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : stats ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
              {t("questReferral.lead", { n: stats.pointsPerInvite })}
            </p>

            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-emerald-400" aria-hidden />
                <span className="text-[var(--muted-foreground)]">{t("questReferral.invited")}</span>
                <span className="font-bold tabular-nums text-[var(--foreground)]">
                  {stats.invitedCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted-foreground)]">{t("questReferral.earned")}</span>
                <span className="font-bold tabular-nums text-emerald-400/90">
                  {stats.pointsEarned} pts
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                {t("settings.referralCodeLabel")}
              </p>
              <code className="block truncate rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 font-mono text-sm tracking-wider text-[var(--foreground)]">
                {stats.referralCode}
              </code>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                {t("settings.referralLinkLabel")}
              </p>
              <input
                readOnly
                value={stats.referralLink}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)]/60 px-3 py-2.5 text-xs text-[var(--foreground)] outline-none"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                className={cn(
                  buttonVariants({ size: "default" }),
                  "w-full rounded-lg border-0 bg-emerald-500 text-white hover:bg-emerald-400 focus-visible:ring-emerald-500/40",
                  copied && "brightness-95",
                )}
              >
                <Copy className="h-4 w-4 shrink-0" aria-hidden />
                {copied ? t("common.copied") : t("questReferral.copyLink")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
