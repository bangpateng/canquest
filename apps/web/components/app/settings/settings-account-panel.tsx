"use client";
import { useCallback, useEffect, useState } from "react";
import { formatPartyIdForDisplay, formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { formatApiError } from "@/lib/api/format-api-error";

type Me = { email?: string; displayName?: string | null; username?: string | null; cantonPartyId?: string | null; twitterUsername?: string | null; avatarUrl?: string | null; };

export function SettingsAccountPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) { setError(formatApiError(raw)); setMe(null); } else setMe(raw as Me);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3 md:px-5"><h3 className="text-sm font-semibold text-[var(--foreground)]">Profile</h3></div>
      <div className="p-4 md:p-5 space-y-4">
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3">
            <img src={me.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]" />
            <div className="min-w-0"><p className="text-sm font-semibold text-[var(--foreground)] truncate">{me.displayName ?? me.twitterUsername}</p><p className="text-xs text-[var(--muted-foreground)]">@{me.twitterUsername}</p></div>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {[{l:"Email",v:me?.email??""},{l:"Display Name",v:me?.displayName??""},{l:"X (Twitter)",v:me?.twitterUsername?`@${me.twitterUsername}`:"Not linked",m:true},{l:"Canton Username",v:formatUsernameForDisplay(me?.username),m:true}].map(f => (
            <div key={f.l}><label className="text-xs font-medium text-[var(--muted-foreground)]">{f.l}</label><input readOnly value={loading?"":f.v} placeholder={loading?"Loading\u2026":"\u2014"} className={`mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm ${f.m?"font-mono text-xs":""} text-[var(--foreground)] outline-none`} /></div>
          ))}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">Canton Party ID</label>
            <input readOnly value={loading?"":me?.cantonPartyId&&!me.cantonPartyId.startsWith("canquest:")?formatPartyIdForDisplay(me.cantonPartyId):""} placeholder={loading?"Loading\u2026":"Not created"} className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none" />
          </div>
        </div>
        {error && <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300" role="alert">{error}</p>}
      </div>
    </section>
  );
}