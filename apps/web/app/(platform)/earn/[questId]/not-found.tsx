import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Lead, PageTitle } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import { cn } from "@/lib/utils";

export default function CampaignQuestNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <PageTitle as="h2">Quest not found</PageTitle>
      <Lead className="mt-2 max-w-sm">
        This campaign may have ended or the link is invalid.
      </Lead>
      <Link href={ROUTES.campaignQuests} className={cn(buttonVariants(), "mt-6")}>
        Back to Earn
      </Link>
    </div>
  );
}
