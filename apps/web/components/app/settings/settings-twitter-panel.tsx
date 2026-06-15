"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useCallback, useEffect, useState } from "react";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { cn } from "@/lib/utils/utils";
import { AtSign, Unlink } from "lucide-react";

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
      className="scroll-mt-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50"
    >
      {/* Section Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            X (Twitter)
          </span>
          <p className="mt-1 text-xs text-slate-500">Connect for quest verification</p>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {status.apiConfigured === false ? (
          <p className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 text-sm font-medium text-orange-200">
            Twitter verification is not configured on this server yet.
          </p>
        ) : null}

        {status.connected && status.username ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-5 py-4 sm:px-6 sm:py-5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs font-semibold text-emerald-300/80 uppercase tracking-wider">Connected</p>
                <p className="mt-0.5 font-mono text-base font-semibold text-slate-100">
                  @{status.username}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDisconnect()}
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-2 rounded-xl")}
            >
              {busy ? <LoadingSpinner size="sm" /> : <Unlink className="h-4 w-4" />}
              Disconnect
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleConnect(e)} className="space-y-4">
            <div>
              <label htmlFor="twitter-handle" className="text-sm font-semibold text-slate-500 flex items-center gap-1.5">
                <AtSign className="h-3.5 w-3.5" />
                X username
              </label>
              <div className="mt-2 flex rounded-xl border border-white/[0.08] bg-[#0a0c14]/80 backdrop-blur-xl transition-all duration-200 focus-within:border-[var(--primary)]/30 focus-within:ring-2 focus-within:ring-[var(--ring)] focus-within:shadow-[0_0_20px_rgb(var(--canton-rgb)/0.08)]">
                <span className="flex items-center pl-4 text-base font-medium text-slate-500">@</span>
                <input
                  id="twitter-handle"
                  value={input}
                  onChange={(e) => setInput(e.target.value.replace(/^@/, ""))}
                  placeholder="your_handle"
                  disabled={busy}
                  className="min-w-0 flex-1 bg-transparent py-3 pr-4 text-base font-medium text-white outline-none placeholder:text-slate-500"
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

        {error ? (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}