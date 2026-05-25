"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef } from "react";

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

type TurnstileFieldProps = {
  onToken: (token: string | null) => void;
  resetKey?: string | number;
};

export function TurnstileField({ onToken, resetKey = 0 }: TurnstileFieldProps) {
  const ref = useRef<TurnstileInstance>(null);

  if (!siteKey) {
    if (process.env.NODE_ENV === "production") {
      return (
        <p className="text-xs text-orange-300">
          Captcha is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
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
        onSuccess={(token) => onToken(token)}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
        options={{ theme: "dark", size: "normal" }}
      />
    </div>
  );
}
