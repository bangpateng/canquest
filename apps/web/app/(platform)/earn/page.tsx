import { EarnCampaignsPage } from "@/components/app/earn-campaigns-page";
import { PlatformPage } from "@/components/platform/platform-page";
import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";
import { Suspense } from "react";

/** Partner campaigns — menu Earn → /earn */
export default function EarnPage() {
  return (
    <PlatformPage>
      <Suspense fallback={null}>
        <WalletRequiredGate>
          <EarnCampaignsPage />
        </WalletRequiredGate>
      </Suspense>
    </PlatformPage>
  );
}
