"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [progress, setProgress] = useState(0);

  const go = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setProgress(0);
      setIndex((i) => (i + delta + items.length) % items.length);
    },
    [items.length],
  );

  useEffect(() => {
    setIndex((i) => (items.length ? i % items.length : 0));
    setProgress(0);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1 || paused) return;

    const start = Date.now();
    let frame: number;

    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / ROTATE_MS);
      setProgress(p);
      if (p >= 1) {
        go(1);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index, items.length, paused, go]);

  if (items.length === 0) return null;

  const current = items[index];

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setProgress(0);
      }}
    >
      <div className="relative overflow-hidden rounded-2xl">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, filter: "blur(8px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(6px)" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <LandingQuestCard quest={current} variant={CARD_VARIANT} />
          </motion.div>
        </AnimatePresence>

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
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-center gap-2">
            {items.map((q, i) => (
              <button
                key={q.id}
                type="button"
                aria-label={`Show ${q.title}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => {
                  setProgress(0);
                  setIndex(i);
                }}
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
