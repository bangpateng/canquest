"use client";
import { InlineLoading } from "@/components/ui/loading-spinner";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, UserPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils/utils";

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
      className="overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]/40"
      aria-label={t("questReferral.aria")}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-[var(--muted)]/20 px-6 py-4">
        <p className="flex items-center gap-3 text-sm font-medium text-slate-400">
          <Gift className="h-4 w-4 text-emerald-400" aria-hidden />
          {t("questReferral.title")}
        </p>
        {stats && !loading ? (
          <span className="text-sm font-semibold tabular-nums text-emerald-400/90">
            +{stats.pointsPerInvite} {t("questReferral.perFriend")}
          </span>
        ) : null}
      </div>

      <div className="px-6 py-6">
        {loading ? (
          <InlineLoading label={t("common.loading")} size="md" />
        ) : error ? (
          <p className="text-sm font-medium text-red-400">{error}</p>
        ) : stats ? (
          <div className="space-y-6">
            <p className="text-sm font-medium leading-relaxed text-slate-400">
              {t("questReferral.lead", { n: stats.pointsPerInvite })}
            </p>

            <div className="flex flex-wrap gap-5 text-base">
              <div className="flex items-center gap-3">
                <UserPlus className="h-5 w-5 text-emerald-400" aria-hidden />
                <span className="text-slate-400">{t("questReferral.invited")}</span>
                <span className="font-bold tabular-nums text-slate-100">
                  {stats.invitedCount}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400">{t("questReferral.earned")}</span>
                <span className="font-bold tabular-nums text-emerald-400/90">
                  {stats.pointsEarned} pts
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-400">
                {t("settings.referralCodeLabel")}
              </p>
              <code className="block truncate rounded-2xl border border-white/5 bg-[var(--muted)]/40 px-4 py-3 font-mono text-base font-medium tracking-wider text-slate-100">
                {stats.referralCode}
              </code>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-400">
                {t("settings.referralLinkLabel")}
              </p>
              <input
                readOnly
                value={stats.referralLink}
                className="w-full rounded-2xl border border-white/5 bg-[var(--background)]/60 px-4 py-3 text-sm font-medium text-slate-100 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                className={cn(buttonVariants({ size: "block" }), copied && "brightness-95")}
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
