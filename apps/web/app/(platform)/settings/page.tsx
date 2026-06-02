import { SettingPageContent } from "@/components/platform/setting-page-content";
import { PlatformPage } from "@/components/platform/platform-page";

export default function SettingPage() {
  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      {/* Page Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white font-sans">
          Settings
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-400 font-normal leading-relaxed">
          Manage your account profile and connected services
        </p>
      </header>
      
      <SettingPageContent />
    </PlatformPage>
  );
}

