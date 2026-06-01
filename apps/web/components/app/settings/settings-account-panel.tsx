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
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900/40 backdrop-blur-xl">
      <div className="border-b border-white/[0.06] bg-white/[0.02] px-6 py-5 sm:px-8">
        <h3 className="text-xl font-semibold tracking-tight text-slate-100">Profile</h3>
      </div>

      <div className="p-6 sm:p-8 md:p-10">
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="mb-8 flex items-center gap-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
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
              <p className="mt-1 text-sm font-medium text-slate-500">@{me.twitterUsername}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
          <div>
            <label
              className="text-sm font-medium text-slate-500"
              htmlFor="settings-email"
            >
              Email
            </label>
            <input
              id="settings-email"
              readOnly
              value={loading ? "" : (me?.email ?? "")}
              placeholder={loading ? "Loading…" : "—"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 text-base font-medium text-slate-100 outline-none transition-colors focus:border-white/[0.12]"
            />
          </div>
          <div>
            <label
              className="text-sm font-medium text-slate-500"
              htmlFor="settings-name"
            >
              Display name
            </label>
            <input
              id="settings-name"
              readOnly
              value={loading ? "" : (me?.displayName ?? "")}
              placeholder={loading ? "Loading…" : "—"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 text-base font-medium text-slate-100 outline-none transition-colors focus:border-white/[0.12]"
            />
          </div>
          <div>
            <label
              className="text-sm font-medium text-slate-500"
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
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 font-mono text-base font-medium text-slate-100 outline-none transition-colors focus:border-white/[0.12]"
            />
          </div>
          <div>
            <label
              className="text-sm font-medium text-slate-500"
              htmlFor="settings-username"
            >
              Canton username
            </label>
            <input
              id="settings-username"
              readOnly
              value={loading ? "" : formatUsernameForDisplay(me?.username)}
              placeholder={loading ? "Loading…" : me?.username ? me.username : "Not set — create via Wallet"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 font-mono text-base font-medium text-slate-100 outline-none transition-colors focus:border-white/[0.12]"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="text-sm font-medium text-slate-500"
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
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 font-mono text-sm font-medium text-slate-100 outline-none transition-colors focus:border-white/[0.12]"
            />
          </div>
        </div>

        {error ? (
          <p
            className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm font-medium text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
