"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/utils";

// ── Display name mapping (internal Cantex name → user-facing) ───────────
// Amulet = nama internal Cantex untuk CC. Untuk user CanQuest, tampilkan "CC".
const DISPLAY_NAMES: Record<string, string> = {
  AMULET: "CC",
};

/** Convert internal instrument id → display name (Amulet → CC). */
export function displayName(id: string): string {
  return DISPLAY_NAMES[id.toUpperCase()] ?? id;
}

// ── Color map for token logos (deterministic by symbol) ─────────────────

const LOGO_COLORS: Record<string, string> = {
  CC: "from-amber-400 to-amber-600",
  AMULET: "from-amber-400 to-amber-600",
  USDCX: "from-blue-400 to-blue-600",
  CBTC: "from-orange-400 to-orange-600",
};
const FALLBACK_GRADIENTS = [
  "from-blue-400 to-blue-600",
  "from-emerald-400 to-emerald-600",
  "from-purple-400 to-purple-600",
  "from-pink-400 to-pink-600",
  "from-cyan-400 to-cyan-600",
  "from-orange-400 to-orange-600",
  "from-indigo-400 to-indigo-600",
  "from-rose-400 to-rose-600",
];

export function gradientFor(symbol: string): string {
  const key = symbol.toUpperCase();
  if (LOGO_COLORS[key]) return LOGO_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++)
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(hash) % FALLBACK_GRADIENTS.length]!;
}

// ── API origin (sama pattern dengan cc-reward-logo) ─────────────────────

export function apiOrigin(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    try {
      return new URL(apiUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return (
    process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ??
    "https://api.canquest.cc"
  );
}

/** Sanitize symbol ke nama file — PRESERVE CASE (match R2 upload as-is).
 * EDELx → EDELx, cETH → cETH, CC → CC. Hanya strip special chars. */
export function logoFileName(symbol: string): string {
  const display = displayName(symbol);
  return display.replace(/[^a-zA-Z0-9]/g, "-");
}

// ── Token Logo component ────────────────────────────────────────────────
//
// Sistem logo: di-serve dari R2 via API proxy /api/uploads/token-logo/<symbol>.
// Endpoint backend coba case-insensitive: webp → png → jpg.
// Kalau gagal load → fallback gradient circle dengan huruf pertama.

export function TokenLogo({
  symbol,
  size = "md",
}: {
  symbol: string;
  size?: "sm" | "md" | "lg";
}) {
  const [imgError, setImgError] = useState(false);
  const letter = displayName(symbol).charAt(0).toUpperCase();
  const dim =
    size === "sm"
      ? "h-6 w-6 text-[11px]"
      : size === "lg"
        ? "h-12 w-12 text-lg"
        : "h-8 w-8 text-sm";
  const src = `${apiOrigin()}/api/uploads/token-logo/${logoFileName(symbol)}`;

  if (!imgError) {
    return (
      <img
        src={src}
        alt={displayName(symbol)}
        onError={() => setImgError(true)}
        className={cn("shrink-0 rounded-full object-cover", dim)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-black",
        gradientFor(symbol),
        dim,
      )}
    >
      {letter}
    </span>
  );
}
