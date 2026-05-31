"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPartyIdForDisplay, formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { formatApiError } from "@/lib/api/format-api-error";

type Me = {
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  twitterUsername?: string | null;
  avatarUrl?: string | null;
};

export function SettingsAccountPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      setError(formatApiError(raw));
      setMe(null);
    } else {
      setMe(raw as Me);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-3xl border border-white/5 bg-[var(--card)] p-8 md:p-10">
      <h3 className="text-xl font-bold text-slate-100">Profile</h3>

      {me?.twitterUsername && me?.avatarUrl ? (
        <div className="mt-8 flex items-center gap-5 rounded-2xl border border-white/5 bg-[var(--muted)]/20 p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={me.avatarUrl}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/10"
          />
          <div>
            <p className="text-base font-semibold text-slate-100">
              {me.displayName ?? me.twitterUsername}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-400">@{me.twitterUsername}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <label
            className="text-sm font-medium text-slate-400"
            htmlFor="settings-email"
          >
            Email
          </label>
          <input
            id="settings-email"
            readOnly
            value={loading ? "" : (me?.email ?? "")}
            placeholder={loading ? "Loading…" : "—"}
            className="mt-2 w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3 text-base font-medium text-slate-100 outline-none"
          />
        </div>
        <div>
          <label
            className="text-sm font-medium text-slate-400"
            htmlFor="settings-name"
          >
            Display name
          </label>
          <input
            id="settings-name"
            readOnly
            value={loading ? "" : (me?.displayName ?? "")}
            placeholder={loading ? "Loading…" : "—"}
            className="mt-2 w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3 text-base font-medium text-slate-100 outline-none"
          />
        </div>
        <div>
          <label
            className="text-sm font-medium text-slate-400"
            htmlFor="settings-x"
          >
            X (Twitter)
          </label>
          <input
            id="settings-x"
            readOnly
            value={
              loading
                ? ""
                : me?.twitterUsername
                  ? `@${me.twitterUsername}`
                  : "Not linked — use Quest / Earn to connect"
            }
            className="mt-2 w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3 font-mono text-base font-medium text-slate-100 outline-none"
          />
        </div>
        <div>
          <label
            className="text-sm font-medium text-slate-400"
            htmlFor="settings-username"
          >
            Canton username
          </label>
          <input
            id="settings-username"
            readOnly
            value={loading ? "" : formatUsernameForDisplay(me?.username)}
            placeholder={loading ? "Loading…" : me?.username ? me.username : "Not set — create via Wallet"}
            className="mt-2 w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3 font-mono text-base font-medium text-slate-100 outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label
            className="text-sm font-medium text-slate-400"
            htmlFor="settings-party"
          >
            Canton Party ID
          </label>
          <input
            id="settings-party"
            readOnly
            value={
              loading
                ? ""
                : me?.cantonPartyId && !me.cantonPartyId.startsWith("canquest:")
                  ? formatPartyIdForDisplay(me.cantonPartyId)
                  : "—"
            }
            placeholder={loading ? "Loading…" : "Not created — go to Wallet"}
            className="mt-2 w-full rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3 font-mono text-sm font-medium text-slate-100 outline-none"
          />
        </div>
      </div>

      {error ? (
        <p
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
