import { QuestHubPage } from "@/components/app/quest/quest-hub-page";
import { PlatformPage } from "@/components/platform/platform-page";

/** CanQuest Quest hub — menu Quest → /quests */
export default function QuestHubRoutePage() {
  return (
    <PlatformPage>
      <QuestHubPage />
    </PlatformPage>
  );
}
