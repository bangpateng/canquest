"use client";

import { useCallback, useEffect, useState } from "react";
import { TurnstileField } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { Loader2, Unlink } from "lucide-react";

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
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
    if (siteKey && !turnstileToken) {
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

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/twitter/disconnect", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(formatApiError(data));
        return;
      }
      setStatus({ connected: false, username: null });
      setInput("");
      setSuccess("X account disconnected.");
      onConnected?.(null);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="twitter"
      className="scroll-mt-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-8"
    >
      <h3 className="type-section-title">X (Twitter)</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Connect your X account to complete follow and retweet tasks on Quest and Earn.
        Verified via{" "}
        <a
          href="https://twitterapi.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-canton underline-offset-2 hover:underline"
        >
          twitterapi.io
        </a>
        .
      </p>

      {status.apiConfigured === false ? (
        <p className="mt-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
          Twitter verification is not configured on this server yet.
        </p>
      ) : null}

      {status.connected && status.username ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-emerald-300/90">Connected</p>
            <p className="mt-0.5 font-mono text-sm text-[var(--foreground)]">@{status.username}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDisconnect()}
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-1.5")}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleConnect(e)} className="mt-5 space-y-3">
          <div>
            <label htmlFor="twitter-handle" className="text-xs font-medium text-[var(--muted-foreground)]">
              X username
            </label>
            <div className="mt-1.5 flex rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 focus-within:border-[var(--primary)]/40 focus-within:ring-2 focus-within:ring-[var(--ring)]">
              <span className="flex items-center pl-3 text-sm text-[var(--muted-foreground)]">@</span>
              <input
                id="twitter-handle"
                value={input}
                onChange={(e) => setInput(e.target.value.replace(/^@/, ""))}
                placeholder="your_handle"
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent py-2.5 pr-3 text-sm outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className={cn(buttonVariants({ size: "sm" }), "gap-2")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Connect X
          </button>
        </form>
      )}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 text-xs font-medium text-emerald-400">{success}</p>
      ) : null}
    </section>
  );
}
