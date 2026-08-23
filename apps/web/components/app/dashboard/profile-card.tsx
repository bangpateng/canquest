"use client";

import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ROUTES } from "@/lib/routing/app-routes";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ArrowUpRight, AtSign } from "lucide-react";

const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #d4ff3f 0%, #8b9c0d 100%)",
  "linear-gradient(145deg, #60a5fa 0%, #1d4ed8 100%)",
  "linear-gradient(145deg, #f472b6 0%, #9333ea 100%)",
  "linear-gradient(145deg, #34d399 0%, #0d9488 100%)",
  "linear-gradient(145deg, #fb923c 0%, #c2410c 100%)",
  "linear-gradient(145deg, #a78bfa 0%, #6d28ed 100%)",
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
    <Card interactive className="relative overflow-hidden p-6 sm:p-7">
      {/* Wash hijau lembut di sisi kiri — identitas brand tanpa warna penuh. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-[linear-gradient(90deg,rgb(var(--canton-rgb)/0.07),transparent_70%)]"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        {/* ── Identity ── */}
        <div className="flex items-center gap-4 sm:gap-5">
          <div
            className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[1.25rem] shadow-[var(--shadow-card)] ring-2 ring-white/70 dark:ring-white/10"
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

          <div className="min-w-0">
            <p className="truncate text-xl font-bold tracking-tight text-[var(--foreground)] sm:text-2xl">
              {name}
            </p>
            {twitterUsername?.trim() ? (
              <a
                href={`https://x.com/${twitterUsername.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-canton hover:underline"
              >
                <AtSign className="h-3 w-3" />
                {twitterUsername.trim()}
              </a>
            ) : (
              <Link
                href="/settings"
                className="mt-1 inline-block text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {t("dashboard.connectTwitter")}
              </Link>
            )}
          </div>
        </div>

        {/* ── Weekly rank badge ── */}
        <Link
          href={ROUTES.leaderboard}
          className="group flex shrink-0 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 transition-colors hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/5"
        >
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("dashboard.weeklyRank")}
            </p>
            <p className="text-xl font-extrabold tabular-nums tracking-tight text-[var(--foreground)]">
              {loading || weeklyRank === null ? "—" : `#${weeklyRank}`}
            </p>
          </div>
          <ArrowUpRight className="h-4 w-4 text-[var(--muted-foreground)] transition-colors group-hover:text-canton" />
        </Link>
      </div>
    </Card>
  );
}
