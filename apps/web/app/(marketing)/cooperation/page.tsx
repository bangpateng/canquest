import type { Metadata } from "next";
import { CooperationPageContent } from "@/components/cooperation/cooperation-page-content";

export const metadata: Metadata = {
  title: "Cooperation — CanQuest",
  description:
    "Partner with CanQuest to launch Earn campaigns, events, and activations on Canton — CC rewards, invite codes, and ecosystem access for your community.",
  alternates: {
    canonical: "/cooperation",
  },
};

export default function CooperationPage() {
  return <CooperationPageContent />;
}
