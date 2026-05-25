"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearReferralRef, getReferralRef, storeReferralRef } from "@/lib/referral-ref";

import { ArrowRight, Loader2 } from "lucide-react";
import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

type PendingOtp = { userId: string; devOtp?: string };

export default function RegisterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);
  const [referralDefault, setReferralDefault] = useState("");

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

    const fd = new FormData(e.currentTarget);
    const displayName = String(fd.get("displayName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const inviteRaw = String(fd.get("inviteCode") ?? "").trim();
    const referralRaw =
      String(fd.get("referralCode") ?? "").trim() || getReferralRef() || undefined;

    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          email,
          password,
          inviteCode: inviteRaw || undefined,
          referralCode: referralRaw,
        }),
      });

      const payloadUnknown: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(formatApiError(payloadUnknown, "Registration failed."));
        return;
      }

      const payload =
        payloadUnknown && typeof payloadUnknown === "object"
          ? (payloadUnknown as Record<string, unknown>)
          : null;

      if (!payload) {
        setError("Unexpected response from registration. Try again.");
        return;
      }

      if (typeof payload.ok === "boolean" && payload.ok === true) {
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
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingOtp) return;
    setError(null);

    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "").trim();

    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pendingOtp.userId, code }),
      });

      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(formatApiError(payload, "Verification failed."));
        return;
      }

      clearReferralRef();
      window.location.assign("/overview");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create account" subtitle="Join quests and earn on Canton">
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
            <label htmlFor="reg-name" className="text-xs font-medium text-[var(--muted-foreground)]">
              Display name
            </label>
            <input
              id="reg-name"
              name="displayName"
              type="text"
              autoComplete="name"
              placeholder="Your Name"
              required
              minLength={2}
              maxLength={80}
              className={authInputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reg-email" className="text-xs font-medium text-[var(--muted-foreground)]">
              Email
            </label>
            <input
              id="reg-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Your Email"
              required
              className={authInputClass}
            />
          </div>
          <PasswordInput
            id="reg-password"
            label="Password"
            autoComplete="new-password"
            placeholder="Minimum 8 characters"
            minLength={8}
            inputClassName="bg-[var(--muted)]/80"
          />
          <div className="space-y-1.5">
            <label htmlFor="reg-invite" className="text-xs font-medium text-[var(--muted-foreground)]">
              Invite code (optional)
            </label>
            <input
              id="reg-invite"
              name="inviteCode"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="Your invite code"
              className={authInputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reg-referral" className="text-xs font-medium text-[var(--muted-foreground)]">
              Friend referral code (optional)
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
          <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              required
              className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--ring)]"
            />
            <span>I agree to the fictitious Terms for this prototype (no legal effect).</span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              buttonVariants(),
              "mt-2 w-full gap-2 rounded-full py-3 font-bold shadow-[0_0_24px_rgb(var(--canton-rgb)/0.2)]",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Creating…" : "Create account"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      ) : (
        <form className="mt-8 space-y-5" onSubmit={onVerifyOtp}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <p>
              OTP sent (or staged in dev). Enter the six-digit code to verify{" "}
              <span className="font-mono text-[var(--foreground)]">{pendingOtp.userId.slice(0, 8)}…</span>.
            </p>
            {pendingOtp.devOtp ? (
              <p className="mt-2 font-mono text-sm text-[var(--foreground)]">Dev OTP: {pendingOtp.devOtp}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reg-otp" className="text-xs font-medium text-[var(--muted-foreground)]">
              OTP code
            </label>
            <input
              id="reg-otp"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="••••••"
              required
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none ring-offset-[var(--card)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={cn(buttonVariants({ size: "default" }), "flex-1")}>
              {busy ? "Verifying…" : "Verify & enter app"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={cn(buttonVariants({ variant: "secondary", size: "default" }))}
              onClick={() => setPendingOtp(null)}
            >
              Back
            </button>
          </div>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        Already have an account?{" "}
        <Link href="/?auth=login" className="font-semibold text-canton hover:underline">
          Sign In
        </Link>
      </p>

      <Link
        href="/"
        className="mt-4 block text-center text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        ← Back to home
      </Link>
    </AuthCard>
  );
}
