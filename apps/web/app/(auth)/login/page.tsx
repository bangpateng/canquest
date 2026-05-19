"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
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
    const email = String(fd.get("email") ?? "").trim();
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
        next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      window.location.assign(safeNext);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Use your CanQuest credentials. Sessions use secure cookies backed by the API.
        </p>
      </div>

      {error ? (
        <div
          className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--muted)]/60 px-3 py-2.5 text-sm text-[var(--foreground)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form className="mt-8 space-y-5" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-xs font-medium text-[var(--muted-foreground)]">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@organization.com"
            required
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="login-password" className="text-xs font-medium text-[var(--muted-foreground)]">
              Password
            </label>
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Forgot link later
            </span>
          </div>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            required
            minLength={1}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-offset-[var(--card)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
          />
        </div>
        <button type="submit" disabled={busy} className={cn(buttonVariants({ size: "default" }), "w-full")}>
          {busy ? "Opening…" : "Continue to app"}
        </button>
      </form>

      <p className="mt-6 border-t border-[var(--border)] pt-6 text-center text-sm text-[var(--muted-foreground)]">
        No account yet?{" "}
        <Link
          href="/register"
          className="font-medium text-canton underline underline-offset-2 decoration-canton hover:decoration-canton-strong"
        >
          Register
        </Link>
      </p>

      <Link
        href="/"
        className="mt-6 block text-center text-xs text-[var(--muted-foreground)] underline-offset-4 hover:underline"
      >
        ← Back to marketing site
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[var(--muted-foreground)]">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
