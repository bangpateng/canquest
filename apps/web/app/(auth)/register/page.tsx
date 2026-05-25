"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearReferralRef, getReferralRef, storeReferralRef } from "@/lib/referral-ref";
import { ArrowRight, Loader2 } from "lucide-react";
import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { TurnstileField } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
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
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
    if (siteKey && !turnstileToken) {
      setError("Complete the captcha before continuing.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    const referralRaw =
      String(fd.get("referralCode") ?? "").trim() || getReferralRef() || undefined;

    setBusy(true);
    try {
      const payload = await register({
        email: String(fd.get("email") ?? ""),
        twitterUsername: String(fd.get("twitterUsername") ?? ""),
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

      setError("Unexpected response from registration. Try again.");
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
    <AuthCard title="Create account" subtitle="Email + X username — verify with OTP">
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
          <div className="space-y-1.5">
            <label htmlFor="reg-x" className="text-xs font-medium text-[var(--muted-foreground)]">
              X (Twitter) username
            </label>
            <div className="flex rounded-xl border border-[var(--border)] bg-[var(--muted)]/80 focus-within:border-[var(--primary)]/40 focus-within:ring-2 focus-within:ring-[var(--ring)]">
              <span className="flex items-center pl-3 text-sm text-[var(--muted-foreground)]">@</span>
              <input
                id="reg-x"
                name="twitterUsername"
                required
                maxLength={15}
                pattern="[A-Za-z0-9_]+"
                placeholder="yourhandle"
                className="min-w-0 flex-1 bg-transparent py-2.5 pr-3 text-sm outline-none"
              />
            </div>
          </div>
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
            className={cn(
              buttonVariants(),
              "mt-2 w-full gap-2 rounded-full py-3 font-bold shadow-[0_0_24px_rgb(var(--canton-rgb)/0.2)]",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Sending code…" : "Create account"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      ) : (
        <form className="mt-8 space-y-5" onSubmit={onVerifyOtp}>
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
            {busy ? "Verifying…" : "Verify & enter app"}
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
