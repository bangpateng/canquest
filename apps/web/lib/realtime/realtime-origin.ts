const DEFAULT_API_ORIGIN = "https://api.canquest.cc";

/**
 * Browser-facing API origin untuk koneksi SSE langsung (bypass Vercel BFF,
 * karena Vercel serverless memutus koneksi ~10s — tidak cocok untuk SSE panjang).
 *
 * Pakai NEXT_PUBLIC_API_ORIGIN (dipakai juga quest-media-url & cc-reward-logo),
 * fallback ke api.canquest.cc.
 */
export function realtimeOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? DEFAULT_API_ORIGIN
  );
}

/** URL SSE stream lengkap dengan token ephemeral. */
export function realtimeStreamUrl(token: string): string {
  return `${realtimeOrigin()}/api/realtime/stream?token=${encodeURIComponent(
    token,
  )}`;
}
