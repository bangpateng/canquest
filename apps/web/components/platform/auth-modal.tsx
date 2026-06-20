"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuthModal, type AuthModalMode } from "@/components/platform/auth-context";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/api/format-api-error";
import { login, register, verifyOtp } from "@/lib/services/api/auth";
import { clearReferralRef, getReferralRef } from "@/lib/routing/referral-ref";
import { clearCachedWalletMe } from "@/lib/auth/wallet-session-cache";
import { inputClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

type PendingOtp = { userId: string; devOtp?: string };

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function AuthModal() {
  const { open, mode, nextPath, openAuth, closeAuth } = useAuthModal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);
  const [referralDefault, setReferralDefault] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = useTurnstileRequired();

  useEffect(() => {
    if (!open) {
      setError(null);
      setPendingOtp(null);
      setTurnstileToken(null);
    } else {
      setReferralDefault(getReferralRef());
      setTurnstileKey((k) => k + 1);
    }
  }, [open]);

  useEffect(() => {
    if (open && !pendingOtp) {
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);
    }
  }, [open, mode, pendingOtp]);

  if (!open) return null;

  function redirectAfterAuth() {
    const next = nextPath;
    const safe =
      next?.startsWith("/") && !next.startsWith("//") ? next : "/overview";
    window.location.assign(safe);
  }

  function requireTurnstile(): boolean {
    if (turnstileRequired === null) {
      setError("Loading captcha… try again in a moment.");
      return false;
    }
    if (!turnstileRequired) return true;
    if (!turnstileToken) {
      setError("Complete the captcha first.");
      return false;
    }
    return true;
  }

  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!requireTurnstile()) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const payload = await login(
        String(fd.get("email") ?? ""),
        String(fd.get("password") ?? ""),
        turnstileToken ?? "",
      );
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
      clearCachedWalletMe();
      closeAuth();
      redirectAfterAuth();
    } catch (err) {
      setError(formatApiError(err, "Sign in failed. Check your email and password."));
      setTurnstileKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!requireTurnstile()) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const referralRaw =
        String(fd.get("referralCode") ?? "").trim() || getReferralRef() || undefined;
      const payload = await register({
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
        referralCode: referralRaw,
        turnstileToken: turnstileToken ?? "",
      });
      if (payload.ok === true) {
        clearReferralRef();
        clearCachedWalletMe();
        closeAuth();
        redirectAfterAuth();
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
      await verifyOtp(pendingOtp.userId, String(fd.get("otp") ?? "").trim());
      clearReferralRef();
      clearCachedWalletMe();
      closeAuth();
      redirectAfterAuth();
    } catch (err) {
      setError(formatApiError(err, "Invalid code."));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: AuthModalMode; label: string }[] = [
    { id: "login", label: "Sign In" },
    { id: "register", label: "Register" },
  ];

  const title = pendingOtp
    ? "Verify email"
    : mode === "login"
      ? "Welcome back"
      : "Create account";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-label="Close"
        onClick={closeAuth}
      />
      <div className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="gradient-mesh pointer-events-none absolute inset-0 opacity-30" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/50 to-transparent" />

        <div className="relative px-6 pb-4 pt-6">
          <button
            type="button"
            onClick={closeAuth}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="pr-8">
            <h2 id="auth-modal-title" className="type-page-title">
              {title}
            </h2>
            {pendingOtp ? (
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Enter the 6-digit code from your email
              </p>
            ) : null}
          </div>

          {!pendingOtp && (
            <div className="mt-5 flex gap-1 rounded-full bg-[var(--muted)] p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    openAuth(t.id, nextPath);
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 rounded-full py-2.5 text-sm font-semibold transition-all",
                    mode === t.id
                      ? "bg-emerald-500 text-white"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative border-t border-[var(--border)] px-6 py-6">
          {error && (
            <div
              className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
              role="alert"
            >
              {error}
            </div>
          )}

          {pendingOtp ? (
            <form onSubmit={onVerifyOtp} className="space-y-5">
              {pendingOtp.devOtp && (
                <p className="rounded-xl border border-canton-muted bg-canton-subtle px-3 py-2 text-center font-mono text-sm text-canton">
                  Dev OTP: {pendingOtp.devOtp}
                </p>
              )}
              <Field label="Verification code">
                <input
                  name="otp"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="000000"
                  className={cn(inputClass, "text-center font-mono text-lg tracking-[0.35em]")}
                />
              </Field>
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonVariants({ size: "block" }), "gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                Verify
              </button>
            </form>
          ) : mode === "login" ? (
            <form onSubmit={onLogin} className="space-y-4">
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </Field>
              <PasswordInput
                id="auth-login-password"
                label="Password"
                autoComplete="current-password"
                placeholder="Your password"
                inputClassName="bg-[var(--muted)]/80"
              />
              <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                Sign In
              </button>
              <p className="text-center text-sm text-[var(--muted-foreground)]">
                No account?{" "}
                <button
                  type="button"
                  className="font-semibold text-canton hover:underline"
                  onClick={() => {
                    openAuth("register", nextPath);
                    setError(null);
                  }}
                >
                  Register
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={onRegister} className="space-y-4">
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </Field>
              <PasswordInput
                id="auth-register-password"
                label="Password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                inputClassName="bg-[var(--muted)]/80"
              />
              <Field label="Referral code (optional)">
                <input
                  name="referralCode"
                  autoComplete="off"
                  placeholder="e.g. CQ8X4K2M"
                  className={inputClass}
                  defaultValue={referralDefault}
                />
              </Field>
              <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                {busy ? "Sending code…" : "Create account"}
              </button>
              <p className="text-center text-sm text-[var(--muted-foreground)]">
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-semibold text-canton hover:underline"
                  onClick={() => {
                    openAuth("login", nextPath);
                    setError(null);
                  }}
                >
                  Sign In
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
