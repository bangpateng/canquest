import { SettingPageContent } from "@/components/platform/setting-page-content";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

export default function SettingPage() {
  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <PlatformPageIntro eyebrow="Settings" title="Account" eyebrowBrand />
      <SettingPageContent />
    </PlatformPage>
  );
}

