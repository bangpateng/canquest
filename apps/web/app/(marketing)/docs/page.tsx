import type { Metadata } from "next";
import { DocsPageContent } from "@/components/docs/docs-page-content";

export const metadata: Metadata = {
  title: "Docs — CanQuest",
  description:
    "Introduction to CanQuest: menus, sign-in, partner campaigns, daily quests, and rewards including CC, invite codes, and Canton ecosystem access.",
  alternates: {
    canonical: "/docs",
  },
};

export default function DocsPage() {
  return <DocsPageContent />;
}
