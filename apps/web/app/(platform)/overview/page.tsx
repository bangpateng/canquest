import { DashboardView } from "@/components/app/dashboard/dashboard-view";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

export default function OverviewPage() {
  return (
    <PlatformPage className="space-y-8">
      <PlatformPageIntro eyebrow="Overview" title="Dashboard" eyebrowBrand />
      <DashboardView />
    </PlatformPage>
  );
}
