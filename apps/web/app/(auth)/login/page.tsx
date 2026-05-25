"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/format-api-error";
import { login, verifyOtp } from "@/lib/services/api/auth";
import { cn } from "@/lib/utils";

type PendingOtp = { userId: string; devOtp?: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = useTurnstileRequired();

  useEffect(() => {
    setTurnstileKey((k) => k + 1);
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
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");

    setBusy(true);
    try {
      const payload = await login(email, password, turnstileToken ?? "");
      if (payload.needsVerification === true) {
        const userId = typeof payload.userId === "string" ? payload.userId : null;
        if (userId) {
          const rawOtp = payload.devOtp;
          const devOtp =
            typeof rawOtp === "string" && /^[0-9]{6}$/.test(rawOtp) ? rawOtp : undefined;
          setPendingOtp({ userId, devOtp });
          return;
        }
      }
      const next = searchParams.get("next");
      const safeNext =
        next?.startsWith("/") && !next.startsWith("//") ? next : "/overview";
      window.location.assign(safeNext);
    } catch (err) {
      setError(formatApiError(err, "Unable to sign in."));
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
      const next = searchParams.get("next");
      const safeNext =
        next?.startsWith("/") && !next.startsWith("//") ? next : "/overview";
      window.location.assign(safeNext);
    } catch (err) {
      setError(formatApiError(err, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  if (pendingOtp) {
    return (
      <AuthCard title="Verify email">
        {error ? (
          <div
            className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          Enter the 6-digit code from your email.
        </p>
        {pendingOtp.devOtp ? (
          <p className="mt-2 text-xs text-orange-300">Dev OTP: {pendingOtp.devOtp}</p>
        ) : null}
        <form className="mt-6 space-y-4" onSubmit={onVerifyOtp}>
          <div className="space-y-1.5">
            <label htmlFor="login-otp" className="text-xs font-medium text-[var(--muted-foreground)]">
              Verification code
            </label>
            <input
              id="login-otp"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={authInputClass}
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className={cn(buttonVariants(), "w-full gap-2 rounded-full py-3 font-bold")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify & continue
          </button>
        </form>
        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          onClick={() => setPendingOtp(null)}
        >
          ← Back to sign in
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome back">
      {error ? (
        <div
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-xs font-medium text-[var(--muted-foreground)]">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            className={authInputClass}
          />
        </div>
        <PasswordInput
          id="login-password"
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          inputClassName="bg-[var(--muted)]/80"
        />
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
          Sign In
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        No account?{" "}
        <Link href="/?auth=register" className="font-semibold text-canton hover:underline">
          Register
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[var(--muted-foreground)]">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
