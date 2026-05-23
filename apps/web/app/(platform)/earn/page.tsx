import { QuestsBrowser } from "@/components/app/quests-browser";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";
import Link from "next/link";
import { ROUTES } from "@/lib/app-routes";

/** Partner campaigns — menu Earn → /earn */
export default function EarnCampaignsPage() {
  return (
    <PlatformPage>
      <PlatformPageIntro
        title="Earn"
        description={
          <>
            Partner campaigns — complete missions for CC rewards, invite codes, and more.
            Daily check-in and social tasks are under{" "}
            <Link href={ROUTES.earnHub} className="font-medium text-canton underline-offset-2 hover:underline">
              Quest
            </Link>
            .
          </>
        }
      />
      <QuestsBrowser />
    </PlatformPage>
  );
}
