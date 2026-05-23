"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

function LoginForm() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");

    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(formatApiError(data, "Unable to sign in."));
        return;
      }

      const next = searchParams.get("next");
      const safeNext =
        next?.startsWith("/") && !next.startsWith("//") ? next : "/overview";
      window.location.assign(safeNext);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to continue to CanQuest">
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
            placeholder="Your Email"
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
