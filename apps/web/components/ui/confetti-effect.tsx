"use client";

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