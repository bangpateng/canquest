"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

type TurnstileConfig = {
  /** Turnstile site key, or "" if not configured. */
  siteKey: string;
};

const ENV_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

/**
 * GET /api/config/public → { turnstileSiteKey }.
 *
 * Env-backed config (statis per deploy). Site key bisa di-inline via
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY — kalau ada, hook return langsung tanpa fetch
 * (initialData). Kalau tidak, fetch sekali dan cache selamanya (staleTime
 * Infinity) karena tidak berubah saat runtime.
 *
 * Dishared antara `TurnstileField` (render widget) dan `useTurnstileRequired`
 * (gate: perlu captcha atau tidak). Sebelumnya keduanya raw-fetch sendiri →
 * auth modal (pakai keduanya) fire 2 request untuk config yang sama.
 */
export function useTurnstileConfig(): UseQueryResult<TurnstileConfig> {
  return useQuery<TurnstileConfig>({
    queryKey: ["config", "public", "turnstile"] as const,
    queryFn: async (): Promise<TurnstileConfig> => {
      const res = await fetch("/api/config/public", { cache: "no-store" });
      if (!res.ok) throw new Error(`config/public ${res.status}`);
      const data = (await res.json()) as { turnstileSiteKey?: string };
      return { siteKey: data.turnstileSiteKey?.trim() ?? "" };
    },
    // Env statis per deploy — tidak berubah saat runtime.
    initialData: ENV_SITE_KEY ? { siteKey: ENV_SITE_KEY } : undefined,
    staleTime: Infinity,
    // Kalau env inline sudah ada, tidak perlu fetch.
    enabled: !ENV_SITE_KEY,
    retry: 2,
  });
}
