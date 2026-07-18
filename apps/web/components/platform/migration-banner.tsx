"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useMe } from "@/lib/hooks/use-me";

/**
 * Banner peringatan migrasi X OAuth.
 *
 * Tampil di Settings / Earn / Leaderboard untuk user lama yang sudah punya
 * twitterUsername tapi belum re-verify via OAuth (twitterOAuthVerified = false).
 *
 * Setelah deadline (TWITTER_OAUTH_MIGRATION_DEADLINE), banner berubah jadi
 * red (danger) — task X sudah di-block backend.
 */
export function MigrationBanner() {
  const { me, isLoading } = useMe();

  // Loading atau no data → jangan tampil apa-apa.
  if (isLoading || !me) return null;

  // Hanya tampil untuk user yang sudah connect X tapi belum OAuth verified.
  const hasTwitter = Boolean(me.twitterUsername?.trim());
  if (!hasTwitter) return null;
  if (me.twitterOAuthVerified) return null;

  // Default copy (pre-deadline). Backend yang enforce block, jadi UI cuma
  // warning — ini tidak menentukan apa task X bisa di-verify atau tidak.
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 sm:px-6 sm:py-5 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="flex-1 text-sm text-amber-100/90">
          <p className="font-semibold text-amber-200">
            Action required: re-verify your X account
          </p>
          <p className="mt-1 text-amber-100/80">
            Akun X Anda (@{me.twitterUsername}) terhubung sebelum kami
            mewajibkan OAuth resmi. Re-verify via X untuk konfirmasi kepemilikan
            dan hindari block pada task X (follow/retweet).
          </p>
          <Link
            href="/settings#twitter"
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
          >
            Go to Settings → Connect X
          </Link>
        </div>
      </div>
    </div>
  );
}
