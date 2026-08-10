"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useCallback, useEffect, useState } from "react";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatApiError } from "@/lib/api/format-api-error";
import { cn } from "@/lib/utils/utils";
import { AtSign } from "lucide-react";

type TwitterStatus = {
  connected: boolean;
  username: string | null;
  apiConfigured?: boolean;
};

export function SettingsTwitterPanel({
  initialUsername,
  onConnected,
}: {
  initialUsername?: string | null;
  onConnected?: (username: string | null) => void;
}) {
  const [status, setStatus] = useState<TwitterStatus>({
    connected: Boolean(initialUsername),
    username: initialUsername ?? null,
  });
  const [input, setInput] = useState(initialUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = useTurnstileRequired();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/twitter/status", {
      credentials: "include",
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as TwitterStatus;
      setStatus(data);
      if (data.username) setInput(data.username);
      onConnected?.(data.username);
    }
  }, [onConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const val = input.trim().replace(/^@/, "");
    if (!val) return;
    if (turnstileRequired === null) {
      setError("Loading captcha… try again in a moment.");
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError("Complete the captcha before connecting.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/twitter/connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: val, turnstileToken: turnstileToken ?? "" }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        username?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setError(formatApiError(data));
        setTurnstileKey((k) => k + 1);
        setTurnstileToken(null);
        return;
      }
      const name = data?.username ?? val;
      setStatus({ connected: true, username: name });
      setSuccess(`Connected as @${name}`);
      onConnected?.(name);
    } catch {
      setError("Network error — try again.");
      setTurnstileKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  // Akun terhubung dikunci permanen — tidak ada disconnect/change di UI ini.

  return (
    <Card
      id="twitter"
      className="scroll-mt-8 overflow-hidden"
    >
      <div className="p-6 sm:p-7">
        {/* Section header */}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          X (Twitter)
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Connect for quest verification
        </p>

        <div className="mt-5 sm:mt-6">
        {status.apiConfigured === false ? (
          <p className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 text-sm font-medium text-orange-200">
            Twitter verification is not configured on this server yet.
          </p>
        ) : null}

        {status.connected && status.username ? (
          <div className="rounded-xl border border-canton-muted bg-canton-subtle px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/20">
                <AtSign className="h-4 w-4 text-canton" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-canton-muted">
                  Connected
                </p>
                <p className="mt-0.5 font-mono text-base font-semibold text-[var(--foreground)]">
                  @{status.username}
                </p>
              </div>
            </div>
            {/* LOCK PERMANEN: akun terhubung tidak bisa diganti / dilepas. */}
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-foreground)]" />
              This X account is permanently linked and cannot be changed or disconnected.
            </p>
          </div>
        ) : (
          <form onSubmit={(e) => void handleConnect(e)} className="space-y-4">
            <div>
              <label
                htmlFor="twitter-handle"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                <AtSign className="h-3.5 w-3.5" />
                X username
              </label>
              <div className="mt-2 flex rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 transition-colors focus-within:border-[var(--primary)]/50">
                <span className="flex items-center pl-4 text-base font-medium text-[var(--muted-foreground)]">@</span>
                <input
                  id="twitter-handle"
                  value={input}
                  onChange={(e) => setInput(e.target.value.replace(/^@/, ""))}
                  placeholder="your_handle"
                  disabled={busy}
                  className="min-w-0 flex-1 bg-transparent py-3 pr-4 text-base font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className={cn(buttonVariants({ size: "sm" }), "gap-2 rounded-xl")}
            >
              {busy ? <LoadingSpinner size="md" /> : null}
              Connect X
            </button>
          </form>
        )}
        </div>

        {error ? (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </Card>
  );
}