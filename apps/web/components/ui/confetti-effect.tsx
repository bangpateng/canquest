"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

export function launchClaimConfetti() {
  // Fire from center/bottom
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#d4ff3f", "#38bdf8", "#a78bfa", "#f472b6", "#fff"],
  });
}

export function ConfettiClaimOverlay({ trigger }: { trigger: boolean }) {
  useEffect(() => {
    if (!trigger) return;
    launchClaimConfetti();
    const timer = setTimeout(() => launchClaimConfetti(), 400);
    return () => clearTimeout(timer);
  }, [trigger]);

  return null;
}