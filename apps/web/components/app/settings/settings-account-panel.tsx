"use client";

import { formatPartyIdForDisplay, formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { formatApiError } from "@/lib/api/format-api-error";
import { useMe } from "@/lib/hooks/use-me";
import { Card } from "@/components/ui/card";
import { User, Mail, AtSign, Shield, Key } from "lucide-react";

type Me = {
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  twitterUsername?: string | null;
  avatarUrl?: string | null;
};

function SettingsField({
  id,
  label,
  value,
  placeholder,
  icon: Icon,
  mono = false,
  loading = false,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  icon: React.ElementType;
  mono?: boolean;
  loading?: boolean;
}) {
  // Read-only field rendered as a clean info row (label left, value right)
  // to match the glassmorphism look. The underlying <input> stays read-only
  // so semantics/focus behaviour are preserved.
  return (
    <label
      htmlFor={id}
      className="group flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3.5 transition-colors hover:border-[var(--primary)]/30 sm:px-5"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/15">
          <Icon className="h-4 w-4 text-canton" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-[13px]">
          {label}
        </span>
      </span>
      <span
        className={`min-w-0 truncate text-right font-semibold text-[var(--foreground)] ${
          mono ? "font-mono text-xs sm:text-sm" : "text-sm sm:text-[15px]"
        }`}
      >
        {loading ? (
          <span className="text-[var(--muted-foreground)]">Loading…</span>
        ) : value ? (
          value
        ) : (
          <span className="font-medium text-[var(--muted-foreground)]">{placeholder}</span>
        )}
      </span>
      {/* Visually hidden read-only input keeps the htmlFor semantics / a11y
          relationship intact without changing the visual layer. */}
      <input id={id} readOnly value={loading ? "" : value} className="sr-only" tabIndex={-1} aria-hidden />
    </label>
  );
}

export function SettingsAccountPanel() {
  // Profil via cache global `useMe` — request ter-dedup lintas halaman.
  // Sebelumnya fetch `/api/me` manual di sini (duplikat dengan dashboard/wallet).
  const { me: meData, isLoading: loading, isError, error } = useMe();
  const me = (meData as Me | undefined) ?? null;
  const errorMsg = isError ? formatApiError(error) : null;

  return (
    <Card className="relative w-full max-w-full overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 0% 0%, rgb(var(--canton-rgb) / 0.10), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative p-6 sm:p-7">
        {/* Section header */}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Profile
        </p>

        {/* Twitter avatar row */}
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="mt-5 flex items-center gap-4 rounded-xl border border-canton-muted bg-canton-subtle p-4 sm:mt-6 sm:gap-5 sm:p-5">
            <img
              src={me.avatarUrl}
              alt=""
              width={64}
              height={64}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-[var(--primary)]/20 sm:h-16 sm:w-16"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[var(--foreground)] sm:text-lg">
                {me.displayName ?? me.twitterUsername}
              </p>
              <p className="mt-1 truncate text-sm font-medium text-canton-muted">
                @{me.twitterUsername}
              </p>
            </div>
          </div>
        ) : null}

        {/* Fields grid */}
        <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4">
          <SettingsField
            id="settings-email"
            label="Email"
            icon={Mail}
            value={me?.email ?? ""}
            placeholder="—"
            loading={loading}
          />
          <SettingsField
            id="settings-name"
            label="Display Name"
            icon={User}
            value={me?.displayName ?? ""}
            placeholder="—"
            loading={loading}
          />
          <SettingsField
            id="settings-x"
            label="X (Twitter)"
            icon={AtSign}
            value={
              me?.twitterUsername
                ? `@${me.twitterUsername}`
                : "Not linked — use Quest / Earn to connect"
            }
            placeholder="Not linked"
            mono
            loading={loading}
          />
          <SettingsField
            id="settings-username"
            label="Canton Username"
            icon={Shield}
            value={formatUsernameForDisplay(me?.username)}
            placeholder={me?.username ?? "Not set — create via Wallet"}
            mono
            loading={loading}
          />
          <div className="sm:col-span-2">
            <SettingsField
              id="settings-party"
              label="Canton Party ID"
              icon={Key}
              value={
                me?.cantonPartyId && !me.cantonPartyId.startsWith("canquest:")
                  ? formatPartyIdForDisplay(me.cantonPartyId)
                  : ""
              }
              placeholder="Not created — go to Wallet"
              mono
              loading={loading}
            />
          </div>
        </div>

        {errorMsg ? (
          <p
            className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4"
            role="alert"
          >
            {errorMsg}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
