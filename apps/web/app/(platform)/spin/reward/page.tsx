"use client";

import { PlatformPage } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Ticket } from "lucide-react";

export default function SpinRewardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage>
      <div
        role="status"
        className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 text-center"
      >
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40 ring-1 ring-white/10">
          <Ticket className="h-12 w-12 text-[var(--primary)]" aria-hidden />
        </div>
        <span className="mt-8 inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-orange-300 bg-orange-500/10 px-4 py-2 rounded-full border border-orange-500/20 backdrop-blur-xl">
          {t("spin.comingSoon")}
        </span>
        <h2 className="mt-6 text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white">
          Spin & Win Feature
        </h2>
        <p className="mt-4 max-w-md text-sm font-normal leading-relaxed text-slate-400 sm:text-base">
          {t("spin.comingSoonHint")}
        </p>
      </div>
    </PlatformPage>
  );
}
