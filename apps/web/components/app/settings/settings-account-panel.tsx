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
    <section className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/70 backdrop-blur-xl shadow-2xl shadow-black/40">
      <div className="border-b border-white/[0.06] bg-white/[0.02] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <h3 className="text-base sm:text-lg font-semibold tracking-tight text-white">Profile</h3>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="mb-6 flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:mb-8 sm:gap-5 sm:p-5">
            <img
              src={me.avatarUrl}
              alt=""
              width={64}
              height={64}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/10 sm:h-16 sm:w-16"
            />
            <div className="min-w-0">
              <p className="text-base font-semibold text-white sm:text-lg truncate">
                {me.displayName ?? me.twitterUsername}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500 truncate">@{me.twitterUsername}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 md:gap-6">
          <div>
            <label
              className="text-xs font-semibold text-slate-500 sm:text-sm"
              htmlFor="settings-email"
            >
              Email
            </label>
            <input
              id="settings-email"
              readOnly
              value={loading ? "" : (me?.email ?? "")}
              placeholder={loading ? "Loading…" : "—"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white outline-none transition-colors focus:border-white/[0.12] sm:py-3.5 sm:text-base"
            />
          </div>
          <div>
            <label
              className="text-xs font-semibold text-slate-500 sm:text-sm"
              htmlFor="settings-name"
            >
              Display name
            </label>
            <input
              id="settings-name"
              readOnly
              value={loading ? "" : (me?.displayName ?? "")}
              placeholder={loading ? "Loading…" : "—"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white outline-none transition-colors focus:border-white/[0.12] sm:py-3.5 sm:text-base"
            />
          </div>
          <div>
            <label
              className="text-xs font-semibold text-slate-500 sm:text-sm"
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
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 font-mono text-sm font-medium text-white outline-none transition-colors focus:border-white/[0.12] sm:py-3.5 sm:text-base"
            />
          </div>
          <div>
            <label
              className="text-xs font-semibold text-slate-500 sm:text-sm"
              htmlFor="settings-username"
            >
              Canton username
            </label>
            <input
              id="settings-username"
              readOnly
              value={loading ? "" : formatUsernameForDisplay(me?.username)}
              placeholder={loading ? "Loading…" : me?.username ? me.username : "Not set — create via Wallet"}
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 font-mono text-sm font-medium text-white outline-none transition-colors focus:border-white/[0.12] sm:py-3.5 sm:text-base"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="text-xs font-semibold text-slate-500 sm:text-sm"
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
              className="mt-2 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 font-mono text-xs font-medium text-white outline-none transition-colors focus:border-white/[0.12] sm:py-3.5 sm:text-sm"
            />
          </div>
        </div>

        {error ? (
          <p
            className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
