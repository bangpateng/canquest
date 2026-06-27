import type { Metadata } from "next";
import { DocsPageContent } from "@/components/docs/docs-page-content";

export const metadata: Metadata = {
  title: "Docs — CanQuest",
  description:
    "How CanQuest works: human verification and anti-sybil sign-up, the app menus, partner campaigns, daily tasks, and what you can earn as a real participant.",
  alternates: {
    canonical: "/docs",
  },
};

export default function DocsPage() {
  return <DocsPageContent />;
}
