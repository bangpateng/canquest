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
        className="h-[min(340px,78vw)] animate-pulse rounded-2xl bg-[var(--muted)]/40 md:h-[400px]"
        aria-hidden
      />
    ),
  },
);

export function FeaturedQuestCarouselDynamic({ quests }: { quests: Quest[] }) {
  return <FeaturedQuestCarousel quests={quests} />;
}
