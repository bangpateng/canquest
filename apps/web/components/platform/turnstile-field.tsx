"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useRef } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTurnstileConfig } from "@/lib/hooks/use-turnstile-config";

type TurnstileFieldProps = {
  onToken: (token: string | null) => void;
  resetKey?: string | number;
};

export function TurnstileField({ onToken, resetKey = 0 }: TurnstileFieldProps) {
  const ref = useRef<TurnstileInstance>(null);
  const { data, isLoading } = useTurnstileConfig();
  const siteKey = data?.siteKey ?? "";

  useEffect(() => {
    onToken(null);
  }, [resetKey, onToken]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-2">
        <LoadingSpinner size="lg" tone="muted" />
      </div>
    );
  }

  if (!siteKey) {
    if (process.env.NODE_ENV === "production") {
      return (
        <p className="text-xs text-orange-300">
          Captcha is not configured. Set{" "}
          <code className="text-[10px]">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> or{" "}
          <code className="text-[10px]">TURNSTILE_SITE_KEY</code> in{" "}
          <strong>apps/web/.env</strong> (Vercel: Project → Environment Variables), then
          rebuild or restart the web process.
        </p>
      );
    }
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
        Dev mode: Turnstile site key not set — server may skip verification.
      </p>
    );
  }

  return (
    <div className="flex justify-center" key={resetKey}>
      <Turnstile
        ref={ref}
        siteKey={siteKey}
        onSuccess={(token: string) => onToken(token)}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
        options={{ theme: "dark", size: "normal" }}
      />
    </div>
  );
}

/**
 * `null` = still loading config from server. `true` = captcha required.
 * `false` = no site key configured (captcha disabled).
 *
 * Uses the shared `useTurnstileConfig` hook so it dedups with `<TurnstileField>`
 * when both are used in the same component (e.g. auth modal).
 */
export function useTurnstileRequired(): boolean | null {
  const { data, isLoading } = useTurnstileConfig();
  if (isLoading) return null;
  return Boolean(data?.siteKey);
}
