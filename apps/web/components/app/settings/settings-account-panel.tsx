"use client";

import { useCallback, useEffect, useState } from "react";
import { formatApiError } from "@/lib/format-api-error";

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
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-8">
      <h3 className="type-section-title">Profile</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Account details. Profile photo comes from your linked X account (Settings → connect X
        when available). Canton wallet is managed on the{" "}
        <a href="/wallet" className="text-canton underline underline-offset-2">
          Wallet
        </a>{" "}
        page.
      </p>

      {me?.twitterUsername && me?.avatarUrl ? (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={me.avatarUrl}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[var(--border)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {me.displayName ?? me.twitterUsername}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">@{me.twitterUsername}</p>
          </div>
        </div>
      ) : me?.twitterUsername ? (
        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          X connected as @{me.twitterUsername} — refresh the page after linking to load your
          photo.
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label
            className="text-xs font-medium text-[var(--muted-foreground)]"
            htmlFor="settings-email"
          >
            Email
          </label>
          <input
            id="settings-email"
            readOnly
            value={loading ? "" : (me?.email ?? "")}
            placeholder={loading ? "Loading…" : "—"}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div>
          <label
            className="text-xs font-medium text-[var(--muted-foreground)]"
            htmlFor="settings-name"
          >
            Display name
          </label>
          <input
            id="settings-name"
            readOnly
            value={loading ? "" : (me?.displayName ?? "")}
            placeholder={loading ? "Loading…" : "—"}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div>
          <label
            className="text-xs font-medium text-[var(--muted-foreground)]"
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
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2.5 font-mono text-sm outline-none"
          />
        </div>
        <div>
          <label
            className="text-xs font-medium text-[var(--muted-foreground)]"
            htmlFor="settings-username"
          >
            Canton username
          </label>
          <input
            id="settings-username"
            readOnly
            value={loading ? "" : (me?.username ?? "")}
            placeholder={loading ? "Loading…" : me?.username ? me.username : "Not set — create via Wallet"}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2.5 font-mono text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label
            className="text-xs font-medium text-[var(--muted-foreground)]"
            htmlFor="settings-party"
          >
            Canton Party ID
          </label>
          <input
            id="settings-party"
            readOnly
            value={loading ? "" : (me?.cantonPartyId ?? "")}
            placeholder={loading ? "Loading…" : "Not created — go to Wallet"}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2.5 font-mono text-xs outline-none"
          />
        </div>
      </div>

      {error ? (
        <p
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
