"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/utils";
import {
  apiOrigin,
  displayName,
  gradientFor,
  logoFileName,
} from "@/components/app/wallet/token-logo";

/**
 * RewardTokenLogo — logo token reward (CC atau USDCx) untuk konteks reward/claim.
 *
 * Sumber gambar: R2 via API proxy `/api/uploads/token-logo/<symbol>` (sama persis
 * dengan TokenLogo wallet — backend case-insensitive: webp→png→jpg).
 *
 * Berbeda dgn `TokenLogo` wallet (size "sm"|"md"|"lg", selalu circle):
 * - `size` numeric (px) supaya match signature `CcRewardLogo` lama (size?: number).
 * - Bentuk default square (rounded-lg) — cocok untuk badge reward card.
 *   Set `circular` utk rounded-full (match wallet style).
 *
 * Fallback: gradient circle + huruf awal token (CC amber, USDCx blue) —OnError.
 *
 * Token yang tidak dikenal → fallback gradient deterministik (lihat gradientFor).
 */
export function RewardTokenLogo({
  token,
  size = 24,
  className,
  circular = false,
}: {
  /** Symbol token: "CC" (Amulet, default) atau "USDCx". Aman null/undefined → CC. */
  token?: string | null;
  size?: number;
  className?: string;
  /** rounded-full (match wallet) vs default rounded-lg (reward card badge). */
  circular?: boolean;
}) {
  const symbol = token?.trim() || "CC";
  const [imgError, setImgError] = useState(false);
  const letter = displayName(symbol).charAt(0).toUpperCase();
  const src = `${apiOrigin()}/api/uploads/token-logo/${logoFileName(symbol)}`;
  const shape = circular ? "rounded-full" : "rounded-lg";

  if (!imgError) {
    return (
      <img
        src={src}
        alt={displayName(symbol)}
        onError={() => setImgError(true)}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cn("shrink-0 object-contain", shape, className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-gradient-to-br font-bold text-black",
        gradientFor(symbol),
        shape,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.45) }}
      aria-label={displayName(symbol)}
    >
      {letter}
    </span>
  );
}
