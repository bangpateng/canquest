"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, ArrowRight } from "lucide-react";
import { useAuthModal, type AuthModalMode } from "@/components/platform/auth-context";
import { TurnstileField, useTurnstileRequired } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/format-api-error";
import {
  refreshSession,
  register,
  requestSignInCode,
  verifyOtp,
} from "@/lib/services/api/auth";
import { clearReferralRef, getReferralRef } from "@/lib/referral-ref";
import { cn } from "@/lib/utils";

type PendingOtp = { userId: string; devOtp?: string };
type SessionState = "idle" | "checking" | "active" | "expired";

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/80 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

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
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [showRecovery, setShowRecovery] = useState(false);
  const turnstileRequired = useTurnstileRequired();

  const redirectAfterAuth = useCallback(() => {
    const next = nextPath;
    const safe =
      next?.startsWith("/") && !next.startsWith("//") ? next : "/overview";
    window.location.assign(safe);
  }, [nextPath]);

  const tryRefreshSession = useCallback(async () => {
    setSessionState("checking");
    setError(null);
    try {
      const payload = await refreshSession();
      if (
        payload.ok === true ||
        typeof payload.accessToken === "string"
      ) {
        setSessionState("active");
        closeAuth();
        redirectAfterAuth();
        return true;
      }
      setSessionState("expired");
      return false;
    } catch {
      setSessionState("expired");
      return false;
    }
  }, [closeAuth, redirectAfterAuth]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setPendingOtp(null);
      setTurnstileToken(null);
      setSessionState("idle");
      setShowRecovery(false);
    } else {
      setReferralDefault(getReferralRef());
      setTurnstileKey((k) => k + 1);
    }
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "login" || pendingOtp) return;
    void tryRefreshSession();
  }, [open, mode, pendingOtp, tryRefreshSession]);

  useEffect(() => {
    if (open && (mode === "register" || showRecovery)) {
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);
    }
  }, [open, mode, showRecovery, pendingOtp]);

  if (!open) return null;

  function requireTurnstile(): boolean {
    if (turnstileRequired === null) {
      setError("Loading captcha… try again in a moment.");
      return false;
    }
    if (!turnstileRequired) return true;
    if (!turnstileToken) {
      setError("Complete the captcha before continuing.");
      return false;
    }
    return true;
  }

  async function onRecoveryLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!requireTurnstile()) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const payload = await requestSignInCode(
        String(fd.get("email") ?? ""),
        turnstileToken ?? "",
      );
      const userId = typeof payload.userId === "string" ? payload.userId : null;
      if (!userId) {
        setError("Unexpected response. Try again.");
        return;
      }
      const rawOtp = payload.devOtp;
      const devOtp =
        typeof rawOtp === "string" && /^[0-9]{6}$/.test(rawOtp) ? rawOtp : undefined;
      setPendingOtp({ userId, devOtp });
    } catch (err) {
      setError(formatApiError(err, "Unable to send recovery code."));
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
        referralCode: referralRaw,
        turnstileToken: turnstileToken ?? "",
      });
      if (payload.ok === true) {
        clearReferralRef();
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
      setError("Unexpected response. Try again.");
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
    ? "Verify your email"
    : mode === "login"
      ? "Welcome back"
      : "Create account";
  const subtitle = pendingOtp
    ? "Enter the 6-digit code we sent you (register or recovery sign-in)"
    : mode === "login"
      ? "We keep you signed in for 30 days — no email unless you need a recovery code"
      : "Email only — connect X later in Settings for quest tasks";

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
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
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
                    setShowRecovery(false);
                  }}
                  className={cn(
                    "flex-1 rounded-full py-2.5 text-sm font-semibold transition-all",
                    mode === t.id
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_16px_rgb(var(--canton-rgb)/0.25)]"
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
                className={cn(buttonVariants(), "w-full gap-2 rounded-full py-3 font-bold")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Verify & continue
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          ) : mode === "login" ? (
            <div className="space-y-4">
              {sessionState === "checking" ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="h-5 w-5 animate-spin text-canton" />
                  Checking your session…
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void tryRefreshSession().finally(() => setBusy(false));
                    }}
                    className={cn(
                      buttonVariants(),
                      "w-full gap-2 rounded-full py-3 font-bold shadow-[0_0_24px_rgb(var(--canton-rgb)/0.2)]",
                    )}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Continue to app
                    {!busy && <ArrowRight className="h-4 w-4" />}
                  </button>
                  <p className="text-center text-xs text-[var(--muted-foreground)]">
                    Uses your saved sign-in (about 30 days). No email is sent.
                  </p>

                  {!showRecovery ? (
                    <button
                      type="button"
                      className="w-full text-center text-sm text-canton hover:underline"
                      onClick={() => {
                        setShowRecovery(true);
                        setError(null);
                      }}
                    >
                      Cleared cookies or new device? Email me a recovery code
                    </button>
                  ) : (
                    <form onSubmit={onRecoveryLogin} className="space-y-4 border-t border-[var(--border)] pt-4">
                      <Field label="Account email">
                        <input
                          name="email"
                          type="email"
                          required
                          autoComplete="email"
                          placeholder="you@example.com"
                          className={inputClass}
                        />
                      </Field>
                      <TurnstileField resetKey={turnstileKey} onToken={setTurnstileToken} />
                      <button
                        type="submit"
                        disabled={busy}
                        className={cn(buttonVariants({ variant: "secondary" }), "w-full rounded-full py-3")}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Send recovery code (uses 1 email)
                      </button>
                    </form>
                  )}
                </>
              )}
              <p className="text-center text-sm text-[var(--muted-foreground)]">
                No account?{" "}
                <button
                  type="button"
                  className="font-semibold text-canton hover:underline"
                  onClick={() => {
                    openAuth("register", nextPath);
                    setError(null);
                    setShowRecovery(false);
                  }}
                >
                  Register
                </button>
              </p>
            </div>
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
                className={cn(
                  buttonVariants(),
                  "mt-2 w-full gap-2 rounded-full py-3 font-bold shadow-[0_0_24px_rgb(var(--canton-rgb)/0.2)]",
                )}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? "Sending code…" : "Create account"}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
              <p className="text-center text-xs text-[var(--muted-foreground)]">
                Link X in Settings after sign-up for follow/retweet quests and leaderboard photo.
              </p>
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
