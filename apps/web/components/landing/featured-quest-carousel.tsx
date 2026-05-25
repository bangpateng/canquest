"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  LandingQuestCard,
  type LandingQuestCardVariant,
} from "@/components/landing/landing-quest-card";
import type { Quest } from "@/lib/quest-types";
import { cn } from "@/lib/utils";

const ROTATE_MS = 5000;

/** Try: "cinematic" (poster) or "spotlight" (split card) */
const CARD_VARIANT: LandingQuestCardVariant = "cinematic";

function liveQuests(quests: Quest[]) {
  return quests.filter(
    (q) => q.status === "ACTIVE" || q.status === "COMING_SOON",
  );
}

export function FeaturedQuestCarousel({ quests }: { quests: Quest[] }) {
  const items = liveQuests(quests);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setIndex((i) => (i + delta + items.length) % items.length);
    },
    [items.length],
  );

  useEffect(() => {
    setIndex((i) => (items.length ? i % items.length : 0));
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const id = window.setInterval(() => go(1), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [index, items.length, paused, go]);

  if (items.length === 0) return null;

  const current = items[index];

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl">
        <div key={current.id} className="landing-carousel-slide">
          <LandingQuestCard quest={current} variant={CARD_VARIANT} />
        </div>

        {items.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous quest"
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 md:left-5"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next quest"
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 md:right-5"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {items.length > 1 ? (
        <div className="mt-5 space-y-3">
          <div className="h-0.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              key={`progress-${current.id}-${paused ? "p" : "r"}`}
              className={cn(
                "h-full rounded-full bg-[var(--primary)]",
                !paused && "landing-carousel-progress",
              )}
              style={
                !paused
                  ? ({ animationDuration: `${ROTATE_MS}ms` } satisfies CSSProperties)
                  : undefined
              }
            />
          </div>
          <div className="flex items-center justify-center gap-2">
            {items.map((q, i) => (
              <button
                key={q.id}
                type="button"
                aria-label={`Show ${q.title}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === index
                    ? "w-8 bg-[var(--primary)]"
                    : "w-2 bg-[var(--muted-foreground)]/35 hover:bg-[var(--muted-foreground)]/60",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
