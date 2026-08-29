import { PlatformPage } from "@/components/platform/platform-page";
import { EcosystemPage } from "@/components/app/ecosystem/ecosystem-page";

export default function EcosystemRoutePage() {
  return (
    <PlatformPage className="space-y-8">
      <EcosystemPage />
    </PlatformPage>
  );
}
