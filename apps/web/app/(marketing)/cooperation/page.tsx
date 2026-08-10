import type { Metadata } from "next";
import { CooperationPageContent } from "@/components/cooperation/cooperation-page-content";

export const metadata: Metadata = {
  title: "Work with CanQuest",
  description:
    "Run a campaign on CanQuest and reach real Canton users. Earn campaigns, launches, and events — with CC, codes, or access as rewards.",
  alternates: {
    canonical: "/cooperation",
  },
};

export default function CooperationPage() {
  return <CooperationPageContent />;
}
