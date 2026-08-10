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
    <Card interactive className="overflow-hidden p-6 sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        {/* ── Identity ── */}
        <div className="flex items-center gap-4">
          <div
            className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
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
            <p className="truncate text-lg font-bold tracking-tight text-[var(--foreground)]">
              {name}
            </p>
            {twitterUsername?.trim() ? (
              <a
                href={`https://x.com/${twitterUsername.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-canton hover:underline"
              >
                <AtSign className="h-3 w-3" />
                {twitterUsername.trim()}
              </a>
            ) : (
              <Link
                href="/settings"
                className="mt-0.5 inline-block text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {t("dashboard.connectTwitter")}
              </Link>
            )}
          </div>
        </div>

        {/* ── Weekly rank badge ── */}
        <Link
          href={ROUTES.leaderboard}
          className="group flex shrink-0 items-center gap-3 rounded-xl bg-[var(--muted)] px-4 py-2.5 transition-colors hover:bg-[var(--primary)]/5"
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
