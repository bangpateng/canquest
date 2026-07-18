"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { cn } from "@/lib/utils/utils";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";

type TwitterStatus = {
  connected: boolean;
  username: string | null;
  connectedAt?: string | null;
  avatarUrl?: string | null;
  apiConfigured?: boolean;
  /** True jika X sudah diverifikasi via OAuth (bukan input teks lama). */
  oauthVerified?: boolean;
  /** True jika Twitter OAuth sudah dikonfigurasi di backend. */
  oauthConfigured?: boolean;
  /** ISO date untuk deadline migrasi user lama (null kalau belum diset). */
  oauthMigrationDeadline?: string | null;
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isPastDeadline(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  return new Date() > d;
}

export function SettingsTwitterPanel({
  initialUsername,
  onConnected,
}: {
  initialUsername?: string | null;
  onConnected?: (username: string | null) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<TwitterStatus>({
    connected: Boolean(initialUsername),
    username: initialUsername ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // True kalau lagi nunggu balik dari Twitter (browser redirect).
  const [awaitingOAuth, setAwaitingOAuth] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/twitter/status", {
      credentials: "include",
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as TwitterStatus;
      setStatus(data);
      onConnected?.(data.username);
    }
  }, [onConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Detect balikan dari /api/twitter/oauth/callback:
  //   ?twitter_oauth=success&username=...
  //   ?twitter_oauth=error&error=...
  useEffect(() => {
    const result = searchParams.get("twitter_oauth");
    const usernameParam = searchParams.get("username");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_desc");

    if (result === "success") {
      setSuccess(
        usernameParam
          ? `Connected as @${usernameParam}`
          : "Your X account is now linked.",
      );
      setAwaitingOAuth(false);
      void refresh();
      router.replace("/settings#twitter");
    } else if (result === "error") {
      const msg = errorDesc || errorParam || "OAuth failed. Please try again.";
      setError(`X OAuth failed: ${msg}`);
      setAwaitingOAuth(false);
      router.replace("/settings#twitter");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  /**
   * Start OAuth flow:
   *   1. GET /api/twitter/auth-url → dapat authorization URL dari backend.
   *   2. Redirect browser ke URL itu → user login & authorize di Twitter.
   *   3. Twitter redirect ke /api/twitter/oauth/callback → BFF forward ke backend.
   *   4. Backend exchange code, persist, redirect ke /settings?twitter_oauth=success.
   */
  async function handleConnectOAuth() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch("/api/twitter/auth-url", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as {
        authorizationUrl?: string;
        message?: string;
      } | null;
      if (!res.ok || !data?.authorizationUrl) {
        setBusy(false);
        setError(
          formatApiError(data) ||
            "Could not start X OAuth. Please try again.",
        );
        return;
      }
      setAwaitingOAuth(true);
      // Redirect browser ke twitter.com authorize page.
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? err.message
          : "Network error while starting OAuth.",
      );
    }
  }

  const deadlineStr = formatDate(status.oauthMigrationDeadline);
  const pastDeadline = isPastDeadline(status.oauthMigrationDeadline);
  const needsReverify =
    status.connected && status.oauthVerified === false;

  return (
    <section
      id="twitter"
      className="scroll-mt-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50"
    >
      {/* Section Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            X (Twitter)
          </span>
          <p className="mt-1 text-xs text-slate-500">
            Connect via official OAuth for quest verification
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {/* Status: API belum dikonfigurasi */}
        {status.apiConfigured === false ? (
          <p className="mb-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 text-sm font-medium text-orange-200">
            Twitter verification (twitterapi.io) is not configured on the server.
          </p>
        ) : null}

        {/* Status: OAuth belum dikonfigurasi di backend */}
        {status.oauthConfigured === false ? (
          <p className="mb-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 text-sm font-medium text-orange-200">
            X OAuth is not configured on the server (TWITTER_CLIENT_ID / SECRET /
            CALLBACK_URL). Please contact support.
          </p>
        ) : null}

        {/* CASE 1: User baru belum connect → tombol Connect X */}
        {!status.connected ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Click the button below to authorize CanQuest to access your X
              account. You will be redirected to Twitter, then returned here
              automatically.
            </p>
            <button
              type="button"
              onClick={() => void handleConnectOAuth()}
              disabled={busy || awaitingOAuth || !status.oauthConfigured}
              className={cn(
                buttonVariants({ size: "default" }),
                "gap-2 rounded-xl w-full sm:w-auto",
              )}
            >
              {busy || awaitingOAuth ? (
                <LoadingSpinner size="md" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-current"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              )}
              {awaitingOAuth ? "Redirecting to X…" : "Connect X"}
            </button>
          </div>
        ) : null}

        {/* CASE 2: User lama perlu re-verify (warning) */}
        {needsReverify && !pastDeadline ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 sm:px-6 sm:py-5 backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">
                  Re-verification required
                </p>
                <p className="mt-1 font-mono text-base font-semibold text-slate-100">
                  @{status.username}
                </p>
                <p className="mt-2 text-sm text-amber-100/80">
                  Your X account was linked before we required official OAuth.
                  {deadlineStr
                    ? ` Re-verify before ${deadlineStr} to keep completing X tasks (follow/retweet).`
                    : " Re-verify via OAuth now to confirm ownership."}
                </p>
                <button
                  type="button"
                  onClick={() => void handleConnectOAuth()}
                  disabled={busy || awaitingOAuth || !status.oauthConfigured}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "secondary" }),
                    "mt-3 gap-2 rounded-xl",
                  )}
                >
                  {busy || awaitingOAuth ? (
                    <LoadingSpinner size="sm" />
                  ) : null}
                  Re-verify via X
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* CASE 3: User lama sudah lewat deadline (danger) */}
        {needsReverify && pastDeadline ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 sm:px-6 sm:py-5 backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-300/90">
                  X tasks blocked
                </p>
                <p className="mt-1 font-mono text-base font-semibold text-slate-100">
                  @{status.username}
                </p>
                <p className="mt-2 text-sm text-red-100/80">
                  X tasks (follow/retweet) are blocked until you re-verify via
                  OAuth. Your points and referrals remain safe.
                </p>
                <button
                  type="button"
                  onClick={() => void handleConnectOAuth()}
                  disabled={busy || awaitingOAuth || !status.oauthConfigured}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "mt-3 gap-2 rounded-xl",
                  )}
                >
                  {busy || awaitingOAuth ? (
                    <LoadingSpinner size="sm" />
                  ) : null}
                  Re-verify via X
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* CASE 4: User verified (sukses) */}
        {status.connected && status.oauthVerified ? (
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-5 py-4 sm:px-6 sm:py-5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-emerald-300/80 uppercase tracking-wider">
                  Connected & Verified
                </p>
                <p className="mt-0.5 font-mono text-base font-semibold text-slate-100">
                  @{status.username}
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Lock className="h-3 w-3 shrink-0" />
              Permanently linked and cannot be changed.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}
