"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCallback, useEffect, useState } from "react";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { cn } from "@/lib/utils/utils";

type TwitterStatus = { connected: boolean; username: string | null; apiConfigured?: boolean; };

export function SettingsTwitterPanel({ initialUsername, onConnected }: { initialUsername?: string | null; onConnected?: (username: string | null) => void; }) {
  const [status, setStatus] = useState<TwitterStatus>({ connected: Boolean(initialUsername), username: initialUsername ?? null });
  const [input, setInput] = useState(initialUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tk, setTk] = useState(0);
  const tr = useTurnstileRequired();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/twitter/status", { credentials: "include", cache: "no-store" });
    if (res.ok) { const d = await res.json() as TwitterStatus; setStatus(d); if (d.username) setInput(d.username); onConnected?.(d.username); }
  }, [onConnected]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function connect(e: React.FormEvent) {
    e.preventDefault(); const val = input.trim().replace(/^@/, ""); if (!val) return;
    if (tr === null) { setError("Loading captcha..."); return; } if (tr && !token) { setError("Complete captcha."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/twitter/connect", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: val, turnstileToken: token ?? "" }) });
      const d = await res.json().catch(() => null) as any;
      if (!res.ok) { setError(formatApiError(d)); setTk(k => k + 1); setToken(null); return; }
      setStatus({ connected: true, username: d?.username ?? val }); setSuccess(`Connected @${d?.username ?? val}`); onConnected?.(d?.username ?? val);
    } catch { setError("Network error."); setTk(k => k + 1); setToken(null); } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setError(null); setSuccess(null);
    try { const res = await fetch("/api/twitter/disconnect", { method: "DELETE", credentials: "include" }); if (!res.ok) { const d = await res.json().catch(() => null); setError(formatApiError(d)); return; } setStatus({ connected: false, username: null }); setInput(""); setSuccess("Disconnected."); onConnected?.(null); }
    catch { setError("Network error."); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3 md:px-5"><h3 className="text-sm font-semibold text-[var(--foreground)]">X (Twitter)</h3></div>
      <div className="p-4 md:p-5 space-y-4">
        {status.apiConfigured === false && <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-xs text-orange-200">Twitter verification not configured.</p>}
        {status.connected && status.username ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2.5">
            <div><p className="text-xs font-medium text-emerald-300">Connected</p><p className="text-sm font-mono font-semibold text-[var(--foreground)]">@{status.username}</p></div>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "rounded-md")}>{busy ? <LoadingSpinner size="sm" /> : "Disconnect"}</button>
          </div>
        ) : (
          <form onSubmit={e => void connect(e)} className="space-y-3">
            <div><label htmlFor="twitter-handle" className="text-xs font-medium text-[var(--muted-foreground)]">X username</label>
              <div className="mt-1.5 flex rounded-md border border-[var(--border)] bg-[var(--muted)] focus-within:border-[var(--primary)]/50 transition-colors"><span className="flex items-center pl-3 text-sm text-[var(--muted-foreground)]">@</span><input id="twitter-handle" value={input} onChange={e => setInput(e.target.value.replace(/^@/, ""))} placeholder="handle" disabled={busy} className="flex-1 bg-transparent py-2 pr-3 text-sm text-[var(--foreground)] outline-none" autoComplete="off" spellCheck={false} /></div>
            </div>
            <TurnstileField resetKey={tk} onToken={setToken} />
            <button type="submit" disabled={busy || !input.trim()} className={cn(buttonVariants({ size: "sm" }), "rounded-md")}>{busy ? <LoadingSpinner size="md" /> : null} Connect</button>
          </form>
        )}
        {error && <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>}
        {success && <p className="text-xs font-medium text-emerald-400">{success}</p>}
      </div>
    </section>
  );
}