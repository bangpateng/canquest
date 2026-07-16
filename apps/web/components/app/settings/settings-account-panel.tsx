"use client";

import { formatPartyIdForDisplay, formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { formatApiError } from "@/lib/api/format-api-error";
import { useMe } from "@/lib/hooks/use-me";
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
  return (
    <div>
      <label
        className="text-xs font-semibold text-slate-500 sm:text-sm flex items-center gap-1.5"
        htmlFor={id}
      >
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={loading ? "" : value}
        placeholder={loading ? "Loading…" : placeholder}
        className={`mt-2 w-full rounded-xl border border-white/[0.08] bg-[#0a0c14]/80 px-4 py-2.5 ${
          mono ? "font-mono text-xs sm:text-sm" : "text-sm sm:text-base"
        } font-medium text-white outline-none transition-all duration-200 focus:border-[var(--primary)]/30 focus:ring-2 focus:ring-[var(--ring)] sm:py-3 backdrop-blur-xl`}
      />
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
    <section className="w-full max-w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50">
      {/* Section Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            Profile
          </span>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {/* Twitter Avatar Row */}
        {me?.twitterUsername && me?.avatarUrl ? (
          <div className="mb-6 flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:mb-8 sm:gap-5 sm:p-5 backdrop-blur-xl">
            <img
              src={me.avatarUrl}
              alt=""
              width={64}
              height={64}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-[var(--primary)]/20 sm:h-16 sm:w-16"
            />
            <div className="min-w-0">
              <p className="text-base font-semibold text-white sm:text-lg truncate">
                {me.displayName ?? me.twitterUsername}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500 truncate">
                @{me.twitterUsername}
              </p>
            </div>
          </div>
        ) : null}

        {/* Fields Grid */}
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 md:gap-6">
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
    </section>
  );
}