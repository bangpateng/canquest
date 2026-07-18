import { Suspense } from "react";
import { SettingPageContent } from "@/components/platform/setting-page-content";
import { PlatformPage } from "@/components/platform/platform-page";

export default function SettingPage() {
  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      {/* Suspense wajib karena SettingsTwitterPanel pakai useSearchParams()
          untuk auto-finalize connect setelah balik dari OAuth callback. */}
      <Suspense fallback={null}>
        <SettingPageContent />
      </Suspense>
    </PlatformPage>
  );
}

