"use client";

import { PlatformPage } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Ticket } from "lucide-react";

export default function SpinRewardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage>
      {/* Coming Soon State — Premium Glassmorphic Card */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
        <div
          role="status"
          className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center sm:py-20 md:py-24"
        >
          {/* Icon Block */}
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/[0.06] bg-slate-800/60 backdrop-blur-xl shadow-xl shadow-black/30 ring-1 ring-white/10 sm:h-24 sm:w-24">
            <Ticket className="h-10 w-10 text-[var(--primary)] sm:h-12 sm:w-12" aria-hidden />
          </div>

          {/* Coming Soon Badge */}
          <span className="mt-8 inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-orange-300 bg-orange-500/10 px-4 py-2 rounded-full border border-orange-500/20 backdrop-blur-xl">
            {t("spin.comingSoon")}
          </span>

          {/* Title */}
          <h2 className="mt-5 text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white">
            Spin &amp; Win Feature
          </h2>

          {/* Description */}
          <p className="mt-4 max-w-md text-sm font-normal leading-relaxed text-slate-400 sm:text-base">
            {t("spin.comingSoonHint")}
          </p>
        </div>
      </div>
    </PlatformPage>
  );
}
