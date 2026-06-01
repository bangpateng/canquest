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
        className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/[0.08] bg-slate-900/40 backdrop-blur-xl">
          <Ticket className="h-10 w-10 text-canton" aria-hidden />
        </div>
        <span className="mt-8 rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-orange-200 backdrop-blur-xl">
          {t("spin.comingSoon")}
        </span>
        <p className="mt-4 max-w-sm text-sm font-medium leading-relaxed text-slate-500 sm:text-base">
          {t("spin.comingSoonHint")}
        </p>
      </div>
    </PlatformPage>
  );
}
