import { EarnCampaignsPage } from "@/components/app/earn-campaigns-page";
import { PlatformPage } from "@/components/platform/platform-page";

/** Partner campaigns — menu Earn → /earn */
export default function EarnPage() {
  return (
    <PlatformPage>
      <EarnCampaignsPage />
    </PlatformPage>
  );
}
