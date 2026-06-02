import { SettingPageContent } from "@/components/platform/setting-page-content";
import { PlatformPage } from "@/components/platform/platform-page";

export default function SettingPage() {
  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <SettingPageContent />
    </PlatformPage>
  );
}

