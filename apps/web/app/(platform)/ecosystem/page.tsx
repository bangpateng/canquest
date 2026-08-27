import { PlatformPage } from "@/components/platform/platform-page";
import { EcosystemView } from "@/components/app/ecosystem/ecosystem-view";

export default function EcosystemPage() {
  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <EcosystemView />
    </PlatformPage>
  );
}
