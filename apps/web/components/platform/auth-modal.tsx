"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuthModal, type AuthModalMode } from "@/components/platform/auth-context";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/api/format-api-error";
import { login, verifyOtp, forgotPassword, resetPassword } from "@/lib/services/api/auth";
import { clearReferralRef, getReferralRef } from "@/lib/routing/referral-ref";
import { clearCachedWalletMe } from "@/lib/auth/wallet-session-cache";
import { inputClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";
import { GoogleSignInButton } from "@/components/platform/google-sign-in-button";

type PendingOtp = { userId: string; devOtp?: string };

function Divider() {
  return (
    <div className="relative py-1">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-[var(--border)]" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-[var(--card)] px-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          or with email
        </span>
      </div>
    </div>
  );
}

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
  const [resetEmail, setResetEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = useTurnstileRequired();
  /**
   * Toggle untuk show/hide form email+password di mode login.
   * Default: hidden (Google prominent). User klik link untuk expand.
   * Safety net untuk admin / existing user yang mau pakai password.
   */
  const [showEmailForm, setShowEmailForm] = useState(false);
  /**
   * Input referral manual di mode register. Dipassing ke GoogleSignInButton
   * via referralOverride supaya ikut dikirim saat user klik Google.
   */
  const [manualReferral, setManualReferral] = useState("");

  useEffect(() => {
    if (!open) {
      setError(null);
      setPendingOtp(null);
      setTurnstileToken(null);
      setShowEmailForm(false);
      setManualReferral("");
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

  // onRegister dihapus dari UI (Fase 2 — register via Google saja).
  // Backend endpoint /auth/register TETAP ada (defense in depth) tapi tidak
  // lagi dipanggil dari modal. Kalau perlu re-enable, restore function ini.

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

  async function onForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!requireTurnstile()) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    setBusy(true);
    try {
      // Always resolves ok (anti-enumeration); move to reset view either way.
      await forgotPassword(email, turnstileToken ?? "");
      setResetEmail(email);
      openAuth("reset", nextPath);
      setError(null);
    } catch (err) {
      // Network/turnstile errors still reach here; surface generically.
      setError(formatApiError(err, "Could not send reset code. Try again."));
      setTurnstileKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "").trim();
    const newPassword = String(fd.get("newPassword") ?? "");
    const confirm = String(fd.get("confirmPassword") ?? "");
    const email = resetEmail || String(fd.get("email") ?? "").trim();

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await resetPassword(email, code, newPassword);
      setResetEmail("");
      closeAuth();
      // Inline notice instead of a toast lib dependency.
      window.setTimeout(() => {
        openAuth("login", nextPath);
        window.alert("Password updated — please sign in.");
      }, 0);
    } catch (err) {
      setError(formatApiError(err, "Invalid or expired reset code."));
    } finally {
      setBusy(false);
    }
  }

  // Tabs Sign In/Register dihapus — register sekarang via Google saja.
  // Login password tetap ada (collapsed), sebagai safety net.
  // Switch antar mode via link di dalam form (lihat body).

  const title = pendingOtp
    ? "Verify email"
    : mode === "login"
      ? "Welcome back"
      : mode === "register"
        ? "Create account"
        : mode === "forgot"
          ? "Forgot password"
          : "Reset password";

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

          {/* Tabs Sign In/Register dihapus (Fase 2). Switch via link di body. */}
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
          ) : mode === "forgot" ? (
            <form onSubmit={onForgot} className="space-y-4">
              <p className="text-sm text-[var(--muted-foreground)]">
                Enter your account email and we&apos;ll send a 6-digit reset code.
              </p>
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  defaultValue={resetEmail}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </Field>
              <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                {busy ? "Sending…" : "Send code"}
              </button>
              <p className="text-center text-sm text-[var(--muted-foreground)]">
                <button
                  type="button"
                  className="font-semibold text-canton hover:underline"
                  onClick={() => {
                    openAuth("login", nextPath);
                    setError(null);
                  }}
                >
                  Back to sign in
                </button>
              </p>
            </form>
          ) : mode === "reset" ? (
            <form onSubmit={onReset} className="space-y-4">
              <p className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                If an account exists for{" "}
                <span className="font-semibold text-[var(--foreground)]">{resetEmail || "that email"}</span>,
                a reset code was sent. Enter the code and a new password below.
              </p>
              <Field label="Reset code">
                <input
                  name="code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="000000"
                  className={cn(inputClass, "text-center font-mono text-lg tracking-[0.35em]")}
                />
              </Field>
              <PasswordInput
                id="auth-reset-password"
                name="newPassword"
                label="New password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                inputClassName="bg-[var(--muted)]/80"
              />
              <PasswordInput
                id="auth-reset-confirm"
                name="confirmPassword"
                label="Confirm new password"
                autoComplete="new-password"
                placeholder="Re-enter new password"
                minLength={8}
                inputClassName="bg-[var(--muted)]/80"
              />
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                Reset password
              </button>
              <p className="text-center text-sm text-[var(--muted-foreground)]">
                <button
                  type="button"
                  className="font-semibold text-canton hover:underline"
                  onClick={() => {
                    openAuth("login", nextPath);
                    setError(null);
                  }}
                >
                  Back to sign in
                </button>
              </p>
            </form>
          ) : mode === "login" ? (
            <div className="space-y-4">
              {/* Google prominent di atas */}
              <GoogleSignInButton
                onSuccess={() => {
                  clearCachedWalletMe();
                  closeAuth();
                  redirectAfterAuth();
                }}
                onError={(msg) => setError(msg)}
              />

              {/* Link toggle untuk show/hide form email+password (safety net). */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailForm((v) => !v);
                    setError(null);
                  }}
                  className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
                >
                  {showEmailForm
                    ? "← Use Google instead"
                    : "Sign in with email instead"}
                </button>
              </div>

              {/* Form email/password di-collapse (default hidden). */}
              {showEmailForm ? (
                <form onSubmit={onLogin} className="space-y-4 pt-2">
                  <Divider />
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
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-medium text-canton hover:underline"
                      onClick={() => {
                        setResetEmail("");
                        openAuth("forgot", nextPath);
                        setError(null);
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
                  <button
                    type="submit"
                    disabled={busy}
                    className={cn(buttonVariants({ size: "block" }), "mt-2 gap-2")}
                  >
                    {busy ? <LoadingSpinner size="md" /> : null}
                    Sign In
                  </button>
                </form>
              ) : null}

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
                  Create one with Google
                </button>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mode register — form email/password DIHAPUS (Fase 2).
                  User baru wajib pakai Google. Referral tetap bisa diinput
                  manual di sini, di-pass ke Google flow via referralOverride. */}
              <GoogleSignInButton
                onSuccess={() => {
                  clearCachedWalletMe();
                  closeAuth();
                  redirectAfterAuth();
                }}
                onError={(msg) => setError(msg)}
                referralOverride={manualReferral}
              />

              {/* Referral input manual — ikut dikirim saat klik Google. */}
              <Field label="Referral code (optional)">
                <input
                  type="text"
                  value={manualReferral || referralDefault}
                  onChange={(e) => setManualReferral(e.target.value.trim().toUpperCase())}
                  autoComplete="off"
                  placeholder="e.g. CQ8X4K2M"
                  className={inputClass}
                />
              </Field>

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
