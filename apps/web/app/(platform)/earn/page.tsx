import { EarnCampaignsPage } from "@/components/app/earn-campaigns-page";
import { PlatformPage } from "@/components/platform/platform-page";
import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";

/** Partner campaigns — menu Earn → /earn */
export default function EarnPage() {
  return (
    <PlatformPage>
      <WalletRequiredGate>
        <EarnCampaignsPage />
      </WalletRequiredGate>
    </PlatformPage>
  );
}
