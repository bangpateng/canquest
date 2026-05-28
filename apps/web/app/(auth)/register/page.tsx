"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearReferralRef, getReferralRef, storeReferralRef } from "@/lib/referral-ref";
import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/format-api-error";
import { register, verifyOtp } from "@/lib/services/api/auth";
import { cn } from "@/lib/utils";

type PendingOtp = { userId: string; devOtp?: string };

export default function RegisterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);
  const [referralDefault, setReferralDefault] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = useTurnstileRequired();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) storeReferralRef(ref);
    setReferralDefault(getReferralRef());
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (turnstileRequired === null) {
      setError("Loading captcha… try again in a moment.");
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError("Complete the captcha first.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    const referralRaw =
      String(fd.get("referralCode") ?? "").trim() || getReferralRef() || undefined;

    setBusy(true);
    try {
      const payload = await register({
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
        referralCode: referralRaw,
        turnstileToken: turnstileToken ?? "",
      });

      if (payload.ok === true) {
        clearReferralRef();
        window.location.assign("/overview");
        return;
      }

      const userId = typeof payload.userId === "string" ? payload.userId : null;
      if (userId) {
        const rawOtp = payload.devOtp;
        const devOtp =
          typeof rawOtp === "string" && /^[0-9]{6}$/.test(rawOtp) ? rawOtp : undefined;
        setPendingOtp({ userId, devOtp });
        return;
      }

      setError("Unexpected response. Please try again.");
    } catch (err) {
      setError(formatApiError(err, "Registration failed."));
      setTurnstileKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingOtp) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await verifyOtp(pendingOtp.userId, String(fd.get("code") ?? "").trim());
      clearReferralRef();
      window.location.assign("/overview");
    } catch (err) {
      setError(formatApiError(err, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={pendingOtp ? "Verify email" : "Create account"}>
      {error ? (
        <div
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {!pendingOtp ? (
        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="reg-email" className="text-xs font-medium text-[var(--muted-foreground)]">
              Email
            </label>
            <input
              id="reg-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              className={authInputClass}
            />
          </div>
          <PasswordInput
            id="reg-password"
            label="Password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
            inputClassName="bg-[var(--muted)]/80"
          />
          <div className="space-y-1.5">
            <label htmlFor="reg-referral" className="text-xs font-medium text-[var(--muted-foreground)]">
              Referral code (optional)
            </label>
            <input
              id="reg-referral"
              name="referralCode"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="e.g. CQ8X4K2M"
              defaultValue={referralDefault}
              className={authInputClass}
            />
          </div>
          <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
          <button
            type="submit"
            disabled={busy}
            className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
          >
            {busy ? <LoadingSpinner size="md" /> : null}
            {busy ? "Sending code…" : "Create account"}
          </button>
        </form>
      ) : (
        <form className="mt-8 space-y-5" onSubmit={onVerifyOtp}>
          <p className="text-sm text-[var(--muted-foreground)]">
            Enter the 6-digit code from your email
          </p>
          {pendingOtp.devOtp ? (
            <p className="font-mono text-sm text-canton">Dev OTP: {pendingOtp.devOtp}</p>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="reg-otp" className="text-xs font-medium text-[var(--muted-foreground)]">
              Verification code
            </label>
            <input
              id="reg-otp"
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              required
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none"
            />
          </div>
          <button type="submit" disabled={busy} className={cn(buttonVariants(), "w-full")}>
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        Already have an account?{" "}
        <Link href="/?auth=login" className="font-semibold text-canton hover:underline">
          Sign In
        </Link>
      </p>
    </AuthCard>
  );
}
