"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useCallback, useEffect, useState } from "react";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { cn } from "@/lib/utils/utils";
import { Unlink } from "lucide-react";

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
      className="scroll-mt-8 rounded-3xl border border-white/5 bg-[var(--card)] p-8 md:p-10"
    >
      <h3 className="text-xl font-bold text-slate-100">X (Twitter)</h3>

      {status.apiConfigured === false ? (
        <p className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-200">
          Twitter verification is not configured on this server yet.
        </p>
      ) : null}

      {status.connected && status.username ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-emerald-300/90">Connected</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100">@{status.username}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDisconnect()}
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-2")}
          >
            {busy ? <LoadingSpinner size="sm" /> : <Unlink className="h-4 w-4" />}
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleConnect(e)} className="mt-8 space-y-4">
          <div>
            <label htmlFor="twitter-handle" className="text-sm font-medium text-slate-400">
              X username
            </label>
            <div className="mt-2 flex rounded-2xl border border-white/5 bg-[var(--muted)]/40 focus-within:border-[var(--primary)]/40 focus-within:ring-2 focus-within:ring-[var(--ring)]">
              <span className="flex items-center pl-4 text-base font-medium text-slate-400">@</span>
              <input
                id="twitter-handle"
                value={input}
                onChange={(e) => setInput(e.target.value.replace(/^@/, ""))}
                placeholder="your_handle"
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent py-3 pr-4 text-base font-medium text-slate-100 outline-none"
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
            {busy ? <LoadingSpinner size="md" /> : null}
            Connect X
          </button>
        </form>
      )}

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-4 text-sm font-semibold text-emerald-400">{success}</p>
      ) : null}
    </section>
  );
}
