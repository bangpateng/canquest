"use client";

import { Suspense } from "react";
import { SpinRewardView } from "@/components/app/spin-reward-view";
import { PlatformPage } from "@/components/platform/platform-page";
import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";

export default function SpinRewardPage() {
  return (
    <Suspense fallback={null}>
      <WalletRequiredGate>
        <PlatformPage>
          <SpinRewardView />
        </PlatformPage>
      </WalletRequiredGate>
    </Suspense>
  );
}
