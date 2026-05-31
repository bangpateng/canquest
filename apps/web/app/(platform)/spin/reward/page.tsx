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
        className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-4 text-center"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30">
          <Ticket className="h-7 w-7 text-canton" aria-hidden />
        </div>
        <span className="mt-6 rounded-full border border-orange-500/40 bg-orange-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-orange-200">
          {t("spin.comingSoon")}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("spin.comingSoonHint")}
        </p>
      </div>
    </PlatformPage>
  );
}
