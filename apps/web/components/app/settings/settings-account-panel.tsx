"use client";

import { useState } from "react";
import { formatPartyIdForDisplay, formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { formatApiError } from "@/lib/api/format-api-error";
import { useMe } from "@/lib/hooks/use-me";
import { Card } from "@/components/ui/card";
import { User, Mail, AtSign, Shield, Key, Copy, Check } from "lucide-react";

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
  copyable = false,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  icon: React.ElementType;
  mono?: boolean;
  loading?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  // Clean info field: small label on top, value below, icon left.
  // The underlying <input readOnly> is VISIBLE so users can see/copy their
  // email, display name, party ID, etc. (previously hidden via sr-only bug).
  return (
    <div className="relative rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={loading ? "" : value || ""}
        placeholder={placeholder}
        className={`mt-1.5 w-full bg-transparent text-sm font-semibold text-[var(--foreground)] outline-none placeholder:font-normal placeholder:text-[var(--muted-foreground)] ${
          mono ? "font-mono text-xs" : ""
        } ${copyable && value ? "pr-9" : ""}`}
      />
      {copyable && value ? (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-canton"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-canton" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

export function SettingsAccountPanel() {
  // Profil via cache global `useMe` — request ter-dedup lintas halaman.
  // Sebelumnya fetch `/api/me` manual di sini (duplikat dengan dashboard/wallet).
  const { me: meData, isLoading: loading, isError, error } = useMe();
  const me = (meData as Me | undefined) ?? null;
  const errorMsg = isError ? formatApiError(error) : null;

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <div className="p-6 sm:p-7">
        {/* Section header */}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Profile
        </p>

        {/* Twitter avatar row */}
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="mt-5 flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-4 sm:mt-6 sm:gap-5 sm:p-5">
            <img
              src={me.avatarUrl}
              alt=""
              width={56}
              height={56}
              className="h-12 w-12 shrink-0 rounded-full object-cover sm:h-14 sm:w-14"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--foreground)] sm:text-base">
                {me.displayName ?? me.twitterUsername}
              </p>
              <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
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
            label="Username"
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
              copyable
            />
          </div>
        </div>

        {errorMsg ? (
          <p
            className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-600 sm:mt-6 sm:px-5 sm:py-4"
            role="alert"
          >
            {errorMsg}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
