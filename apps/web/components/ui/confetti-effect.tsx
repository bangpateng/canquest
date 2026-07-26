"use client";

import confetti from "canvas-confetti";

/**
 * Burst konfeti saat claim reward berhasil.
 *
 * Token-aware (optional): USDCx = nada biru, CC = nada mint/amber.
 * Dual-burst (tengah + sudut) supaya lebih meriah tanpa berlebihan.
 *
 * Signature tetap kompatibel: `launchClaimConfetti()` (tanpa arg) jalan seperti biasa.
 */
export function launchClaimConfetti(token?: "CC" | "USDCx" | string | null) {
  const isUsdcx = token?.toUpperCase() === "USDCX";
  const palette = isUsdcx
    ? ["#38bdf8", "#0ea5e9", "#7dd3fc", "#bae6fd", "#fff"] // biru USDCx
    : ["#d4ff3f", "#5ad98a", "#a7f3d0", "#fbbf24", "#fff"]; // mint/amber CC

  // Burst 1: dari bawah-tengah (utama).
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: palette,
  });

  // Burst 2: dari sudut kanan-atas (delayed, lebih kecil) — efek "shower".
  setTimeout(() => {
    confetti({
      particleCount: 60,
      spread: 55,
      origin: { x: 0.92, y: 0.15 },
      colors: palette,
    });
  }, 200);

  // Burst 3 (opsional, subtle): dari kiri-atas — simetri ringan.
  setTimeout(() => {
    confetti({
      particleCount: 40,
      spread: 45,
      origin: { x: 0.08, y: 0.18 },
      colors: palette,
    });
  }, 350);
}
