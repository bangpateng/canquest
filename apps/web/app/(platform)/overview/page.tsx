import { DashboardView } from "@/components/app/dashboard-view";
import { PlatformPage } from "@/components/platform/platform-page";

export default function OverviewPage() {
  return (
    <PlatformPage className="space-y-8">
      <DashboardView />
    </PlatformPage>
  );
}
