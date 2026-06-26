"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import { Trophy } from "lucide-react";
import Link from "next/link";

const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #d4ff3f 0%, #8b9c0d 100%)",
  "linear-gradient(145deg, #60a5fa 0%, #1d4ed8 100%)",
  "linear-gradient(145deg, #f472b6 0%, #9333ea 100%)",
  "linear-gradient(145deg, #34d399 0%, #0d9488 100%)",
  "linear-gradient(145deg, #fb923c 0%, #c2410c 100%)",
  "linear-gradient(145deg, #a78bfa 0%, #6d28d9 100%)",
];

function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export interface ProfileCardProps {
  displayName?: string | null;
  username?: string | null;
  twitterUsername?: string | null;
  avatarUrl?: string | null;
  weeklyRank: number | null;
  loading: boolean;
}

export function ProfileCard({
  displayName,
  username,
  twitterUsername,
  avatarUrl,
  weeklyRank,
  loading,
}: ProfileCardProps) {
  const t = usePlatformT();
  const name = displayName?.trim() || username?.trim() || "Guest";
  const avatarSrc = avatarUrl?.trim() ? avatarUrl.trim() : null;
  const seed = username?.trim() || displayName?.trim() || "guest";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_0%_0%,rgb(251_191_36/0.08),transparent_70%)]"
        aria-hidden
      />
      <div className="relative flex items-center gap-4">
        <div
          className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-2 ring-white/10"
          aria-hidden
          style={avatarSrc ? undefined : { backgroundImage: avatarGradient(seed) }}
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-lg font-bold uppercase tracking-wider text-white">
              {getInitials(name)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold tracking-tight text-white">{name}</p>
          {twitterUsername?.trim() ? (
            <a
              href={`https://x.com/${twitterUsername.trim()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-block max-w-full truncate text-sm font-medium text-[var(--primary)] hover:underline"
            >
              @{twitterUsername.trim()}
            </a>
          ) : (
            <Link
              href="/settings"
              className="mt-0.5 inline-block text-sm font-medium text-slate-500 hover:text-slate-300"
            >
              {t("dashboard.connectTwitter")}
            </Link>
          )}
        </div>
      </div>

      {/* Weekly rank strip */}
      <div className="relative mt-5 flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20">
            <Trophy className="h-5 w-5 text-amber-400" aria-hidden />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t("dashboard.weeklyRank")}
            </p>
            <p className="text-xl font-extrabold tabular-nums tracking-tight text-white">
              {loading || weeklyRank === null ? "—" : `#${weeklyRank}`}
            </p>
          </div>
        </div>
        <Link
          href={ROUTES.leaderboard}
          className="shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          {t("dashboard.viewLeaderboard")}
        </Link>
      </div>
    </div>
  );
}
