"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type TurnstileFieldProps = {
  onToken: (token: string | null) => void;
  resetKey?: string | number;
};

export function TurnstileField({ onToken, resetKey = 0 }: TurnstileFieldProps) {
  const ref = useRef<TurnstileInstance>(null);
  const [siteKey, setSiteKey] = useState(
    () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "",
  );
  const [loading, setLoading] = useState(!siteKey);

  useEffect(() => {
    if (siteKey) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/config/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { turnstileSiteKey?: string } | null) => {
        if (cancelled) return;
        const key = data?.turnstileSiteKey?.trim() ?? "";
        setSiteKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  useEffect(() => {
    onToken(null);
  }, [resetKey, onToken]);

  if (loading) {
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

/** `null` = still loading config from server. */
export function useTurnstileRequired(): boolean | null {
  const inlined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const [required, setRequired] = useState<boolean | null>(
    inlined ? true : null,
  );

  useEffect(() => {
    if (inlined) return;
    void fetch("/api/config/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { turnstileSiteKey?: string } | null) => {
        setRequired(Boolean(data?.turnstileSiteKey?.trim()));
      })
      .catch(() => setRequired(false));
  }, [inlined]);

  return required;
}
