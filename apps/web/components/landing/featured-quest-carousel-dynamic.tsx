"use client";

import dynamic from "next/dynamic";
import type { Quest } from "@/lib/quest-types";

const FeaturedQuestCarousel = dynamic(
  () =>
    import("@/components/landing/featured-quest-carousel").then((m) => ({
      default: m.FeaturedQuestCarousel,
    })),
  {
    loading: () => (
      <div
        className="aspect-[16/10] max-h-[min(420px,72vw)] w-full animate-pulse rounded-2xl bg-[var(--muted)]/40 sm:aspect-[2/1]"
        aria-hidden
      />
    ),
  },
);

export function FeaturedQuestCarouselDynamic({ quests }: { quests: Quest[] }) {
  return <FeaturedQuestCarousel quests={quests} />;
}
