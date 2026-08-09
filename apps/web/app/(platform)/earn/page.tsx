import { EarnCampaignsPage } from "@/components/app/earn/earn-campaigns-page";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";
import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";
import { Suspense } from "react";

/** Partner campaigns — menu Earn → /earn */
export default function EarnPage() {
  return (
    <PlatformPage>
      <PlatformPageIntro eyebrow="Earn" title="Partner campaigns" eyebrowBrand />
      <Suspense fallback={null}>
        <WalletRequiredGate>
          <EarnCampaignsPage />
        </WalletRequiredGate>
      </Suspense>
    </PlatformPage>
  );
}
