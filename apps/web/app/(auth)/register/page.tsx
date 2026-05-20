"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

type PendingOtp = { userId: string; devOtp?: string };

export default function RegisterPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const displayName = String(fd.get("displayName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const inviteRaw = String(fd.get("inviteCode") ?? "").trim();

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
        window.location.assign("/dashboard");
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

      window.location.assign("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          Create account
        </h1>

      </div>

      {error ? (
        <div
          className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--muted)]/60 px-3 py-2.5 text-sm text-[var(--foreground)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {!pendingOtp ? (
        <form className="mt-8 space-y-5" onSubmit={onSubmit}>
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
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
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
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reg-password" className="text-xs font-medium text-[var(--muted-foreground)]">
              Password
            </label>
            <input
              id="reg-password"
              name="password"
              type="password"
              autoComplete="new-password"
            placeholder="Minimum 8 characters"
            required
            minLength={8}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reg-invite" className="text-xs font-medium text-[var(--muted-foreground)]">
              Invitation code
            </label>
            <input
              id="reg-invite"
              name="inviteCode"
              type="text"
              inputMode="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="Your Code Invite"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 font-mono text-sm tracking-wide outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
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
          <button type="submit" disabled={busy} className={cn(buttonVariants({ size: "default" }), "w-full")}>
            {busy ? "Creating…" : "Create account"}
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

      <p className="mt-6 border-t border-[var(--border)] pt-6 text-center text-sm text-[var(--muted-foreground)]">
        Already have access?{" "}
        <Link
          href="/login"
          className="font-medium text-canton underline underline-offset-2 decoration-canton hover:decoration-canton-strong"
        >
          Sign in
        </Link>
      </p>

      <Link
        href="/"
        className="mt-6 block text-center text-xs text-[var(--muted-foreground)] underline-offset-4 hover:underline"
      >
        ← Back to home
      </Link>
    </div>
  );
}
