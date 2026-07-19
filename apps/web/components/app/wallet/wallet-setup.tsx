"use client";

import { normalizeWalletUsername } from "@/lib/canton/canton-party-id";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui/ui-tokens";
import { formatApiError } from "@/lib/api/format-api-error";
import { Wallet, Lock, CheckCircle2, ArrowLeft, MailCheck } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OtpInput } from "@/components/ui/otp-input";
import { Countdown } from "@/components/ui/countdown";
import { useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { useMe } from "@/lib/hooks/use-me";

type Step = "form" | "otp" | "success";

interface WalletSetupProps {
  onCreated: () => void;
}

/**
 * Multi-step wallet creation form (Fase 1.5).
 *
 * State machine:
 *   form → (submit /party/wallet/otp/send) → otp
 *   otp  → (input 6 digit + submit /party/wallet/otp/verify) → success
 *   success → (auto-redirect via onCreated)
 *
 * Fields: email (read-only, verified badge), username, firstName, lastName
 * (optional, forwarded to Keycloak only), invite code (conditional).
 */
export function WalletSetup({ onCreated }: WalletSetupProps) {
  const t = usePlatformT();
  const { me } = useMe();

  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [needsInvite, setNeedsInvite] = useState(true);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const [otpExpired, setOtpExpired] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);

  useEffect(() => {
    void fetch("/api/party/wallet-access", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasRedeemedInvite?: boolean } | null) => {
        if (data && typeof data.hasRedeemedInvite === "boolean") {
          setNeedsInvite(!data.hasRedeemedInvite);
        }
      })
      .catch(() => undefined);
  }, []);

  const email = me?.email ?? "";

  function resetOtpCooldown() {
    setResendCooldown(true);
    setTimeout(() => setResendCooldown(false), 120_000); // 2 menit
  }

  async function handleSubmitForOtp(e: React.FormEvent) {
    e.preventDefault();
    const val = normalizeWalletUsername(username) ?? "";
    if (!val || val.length < 3) return;
    if (needsInvite && inviteCode.trim().length < 4) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: val,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as
        | { message?: string; expiresAt?: string; devOtp?: string }
        | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      setOtpExpiresAt(raw?.expiresAt ?? null);
      setOtp("");
      setOtpExpired(false);
      setStep("otp");
      resetOtpCooldown();

      // Dev convenience: kalau backend kirim devOtp (NODE_ENV !== production),
      // auto-isi supaya dev tidak perlu cek email.
      if (raw?.devOtp && /^[0-9]{6}$/.test(raw.devOtp)) {
        setOtp(raw.devOtp);
      }
    } catch (err) {
      setError(formatApiError(err, "Could not send verification code."));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (otp.length !== 6) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizeWalletUsername(username) ?? username,
          code: otp,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      setStep("success");
      setTimeout(() => onCreated(), 1500);
    } catch (err) {
      setError(formatApiError(err, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendOtp() {
    if (resendCooldown || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizeWalletUsername(username) ?? username,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as
        | { expiresAt?: string; devOtp?: string }
        | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      setOtpExpiresAt(raw?.expiresAt ?? null);
      setOtp("");
      setOtpExpired(false);
      resetOtpCooldown();

      if (raw?.devOtp && /^[0-9]{6}$/.test(raw.devOtp)) {
        setOtp(raw.devOtp);
      }
    } catch (err) {
      setError(formatApiError(err, "Could not resend verification code."));
    } finally {
      setBusy(false);
    }
  }

  // ── Render step: OTP ─────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <div className="w-full min-w-0 max-w-md">
          <div className="mb-8 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/5 bg-canton/10">
              <MailCheck className="h-10 w-10 text-canton" />
            </div>
          </div>

          <h2 className="text-center text-2xl font-bold text-slate-100">
            {t("wallet.otpTitle")}
          </h2>
          <p className="mt-3 text-center text-sm font-medium text-slate-400">
            {t("wallet.otpSubtitle")}{" "}
            <span className="font-semibold text-slate-300">{email}</span>
          </p>

          <form onSubmit={handleVerifyOtp} className="mt-8 space-y-6">
            {otpExpiresAt ? (
              <div className="text-center">
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={(code) => {
                    setOtp(code);
                  }}
                  disabled={busy || otpExpired}
                />
                <p className="mt-3 text-xs font-medium text-slate-500">
                  {t("wallet.otpExpiresIn")}{" "}
                  <Countdown
                    expiresAt={otpExpiresAt}
                    onExpire={() => setOtpExpired(true)}
                    className={cn(
                      "font-mono font-semibold",
                      otpExpired ? "text-red-400" : "text-slate-300",
                    )}
                  />
                </p>
              </div>
            ) : null}

            {error ? (
              <p
                className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || otp.length !== 6 || otpExpired}
              className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
            >
              {busy ? <LoadingSpinner size="md" /> : null}
              {t("wallet.verifyAndCreate")}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setError(null);
                  setOtp("");
                }}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("wallet.backToForm")}
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendCooldown || busy}
                className={cn(
                  "font-semibold",
                  resendCooldown
                    ? "cursor-not-allowed text-slate-600"
                    : "text-canton hover:underline",
                )}
              >
                {resendCooldown ? t("wallet.resendIn") : t("wallet.resendCode")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Render step: SUCCESS ─────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <div className="w-full min-w-0 max-w-md text-center">
          <div className="mb-8 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-slate-100">
            {t("wallet.successTitle")}
          </h2>
          <p className="mt-3 text-sm font-medium text-slate-400">
            {t("wallet.successSubtitle")}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-canton">
            <LoadingSpinner size="sm" />
            <span className="text-sm">{t("wallet.walletCreatedLoading")}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Render step: FORM (default) ──────────────────────────────────────────
  return (
    <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
      <div className="w-full min-w-0 max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/5 bg-canton/10">
            <Wallet className="h-10 w-10 text-canton" />
          </div>
        </div>

        <h2 className="text-center text-2xl font-bold text-slate-100">
          {t("wallet.createTitle")}
        </h2>
        <p className="mt-3 text-center text-sm font-medium text-slate-400">
          {needsInvite ? t("wallet.inviteCodeHint") : t("wallet.inviteCodeRetryHint")}
        </p>

        <form onSubmit={handleSubmitForOtp} className="mt-10 space-y-6">
          {/* Email (read-only, verified via Google badge) */}
          {email ? (
            <div className="space-y-2">
              <label
                htmlFor="wallet-email"
                className="text-sm font-medium text-slate-400"
              >
                {t("wallet.emailLabel")}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="wallet-email"
                  value={email}
                  readOnly
                  className={cn(inputClass, "pl-10 opacity-80")}
                />
              </div>
              <p className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("wallet.emailVerified")}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="wallet-username"
              className="text-sm font-medium text-slate-400"
            >
              {t("wallet.usernameLabel")}{" "}
              <span className="font-normal text-slate-500">
                ({t("wallet.usernameHint")})
              </span>
            </label>
            <input
              id="wallet-username"
              value={username}
              onChange={(e) =>
                setUsername(
                  e.target.value.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, ""),
                )
              }
              placeholder="e.g. alex_canton"
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]+"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={busy}
              className={cn(inputClass, "font-mono")}
            />
          </div>

          {/* First/last name (side-by-side, optional) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label
                htmlFor="wallet-first-name"
                className="text-sm font-medium text-slate-400"
              >
                {t("wallet.firstNameLabel")}
              </label>
              <input
                id="wallet-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value.slice(0, 50))}
                maxLength={50}
                autoComplete="given-name"
                disabled={busy}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="wallet-last-name"
                className="text-sm font-medium text-slate-400"
              >
                {t("wallet.lastNameLabel")}
              </label>
              <input
                id="wallet-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value.slice(0, 50))}
                maxLength={50}
                autoComplete="family-name"
                disabled={busy}
                className={inputClass}
              />
            </div>
          </div>
          <p className="-mt-3 text-xs text-slate-500">
            {t("wallet.nameOptionalHint")}
          </p>

          {needsInvite ? (
            <div className="space-y-2">
              <label
                htmlFor="wallet-invite-code"
                className="text-sm font-medium text-slate-400"
              >
                {t("wallet.inviteCodeLabel")}
              </label>
              <input
                id="wallet-invite-code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.replace(/\s+/g, ""))}
                placeholder="8-character code (e.g. aB3xKp9Q)"
                minLength={4}
                maxLength={64}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy}
                className={cn(inputClass, "font-mono")}
              />
            </div>
          ) : null}

          {error ? (
            <p
              className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={
              busy ||
              username.trim().length < 3 ||
              (needsInvite && inviteCode.trim().length < 4)
            }
            className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
          >
            {busy ? (
              <>
                <LoadingSpinner size="md" />
                {t("wallet.sendingCode")}
              </>
            ) : (
              <>
                <Wallet className="h-5 w-5" />
                {t("wallet.sendOtpButton")}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
