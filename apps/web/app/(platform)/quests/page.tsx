import { QuestHubPage } from "@/components/app/quest/quest-hub-page";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

/** CanQuest Quest hub — menu Quest → /quests */
export default function QuestHubRoutePage() {
  return (
    <PlatformPage>
      <PlatformPageIntro eyebrow="Quests" title="Daily tasks & points" eyebrowBrand />
      <QuestHubPage />
    </PlatformPage>
  );
}
