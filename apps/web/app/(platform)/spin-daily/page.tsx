"use client";



import { SpinDemo } from "@/components/app/spin-demo";

import { usePlatformT } from "@/lib/i18n/platform-provider";

import { cn } from "@/lib/utils";



const SPIN_COMING_SOON = true;



export default function SpinDailyPage() {

  const t = usePlatformT();



  return (

    <div className="space-y-6">

      <div className="relative">

        <div

          aria-hidden={SPIN_COMING_SOON}

          className={cn(SPIN_COMING_SOON && "pointer-events-none select-none opacity-50")}

        >

          <SpinDemo />

        </div>

        {SPIN_COMING_SOON && (

          <div className="absolute inset-0 z-10 flex min-h-[280px] items-center justify-center bg-[var(--background)]/75 backdrop-blur-sm">

            <div className="glass-card mx-4 max-w-md rounded-2xl p-8 text-center">

              <p className="type-section-title">

                {t("spin.comingSoon")}

              </p>

              <p className="mt-2 text-sm text-[var(--muted-foreground)]">

                {t("spin.comingSoonHint")}

              </p>

            </div>

          </div>

        )}

      </div>

    </div>

  );

}

