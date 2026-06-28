import type { Metadata } from "next";
import { BrandKitPageContent } from "@/components/brand-kit/brand-kit-page-content";

export const metadata: Metadata = {
  title: "Brand Kit — CanQuest",
  description:
    "CanQuest brand assets: logo, color palette, and typography for press, partners, and community creators.",
  alternates: {
    canonical: "/brand-kit",
  },
};

export default function BrandKitPage() {
  return <BrandKitPageContent />;
}
