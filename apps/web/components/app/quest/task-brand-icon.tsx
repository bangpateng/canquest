"use client";

import { cn } from "@/lib/utils/utils";
import { CalendarCheck, HelpCircle, Mail, Fingerprint, UserPlus, Repeat2 } from "lucide-react";

/**
 * Brand logo untuk task — gaya Galxe/QuestN: ikon platform asli (X, Discord,
 * Telegram) dengan warna brand. Untuk task non-sosial (email, wallet, quiz,
 * check-in) pakai ikon aksi generik.
 *
 * Semua logo di-render dalam container berwarna supaya konsisten dan mudah
 * dikenali, bukan ikon generik lucide yang ambigu.
 */

const BRAND = {
  twitter: {
    color: "bg-black text-white dark:bg-white dark:text-black",
    glyph: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  discord: {
    color: "bg-[#5865F2] text-white",
    glyph: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
  telegram: {
    color: "bg-[#26A5E4] text-white",
    glyph: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
} as const;

/** Ikon aksi kecil yang di-overlay di pojok brand badge (follow/retweet/dll). */
function ActionGlyph({ type }: { type: string }) {
  const cls = "h-3 w-3";
  switch (type) {
    case "twitter_follow":
      return <UserPlus className={cls} aria-hidden />;
    case "twitter_retweet":
      return <Repeat2 className={cls} aria-hidden />;
    default:
      return null;
  }
}

/**
 * Badge ikon task gaya Galxe: container bulat berwarna brand + logo, dengan
 * overlay ikon aksi kecil untuk task sosial (follow/retweet).
 */
export function TaskBrandIcon({
  type,
  complete = false,
  className,
}: {
  type: string;
  complete?: boolean;
  className?: string;
}) {
  const t = type as string;
  let brand: keyof typeof BRAND | null = null;
  if (t === "twitter_follow" || t === "twitter_retweet") brand = "twitter";
  else if (t === "discord_join") brand = "discord";
  else if (t === "telegram_channel" || t === "telegram_group" || t === "telegram_join")
    brand = "telegram";

  // Verified: badge hijau dengan check (override warna brand).
  if (complete) {
    return (
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
          className,
        )}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  if (brand) {
    const b = BRAND[brand];
    return (
      <span className={cn("relative shrink-0", className)}>
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl",
            b.color,
          )}
        >
          {b.glyph}
        </span>
        <ActionGlyphOverlay type={t} />
      </span>
    );
  }

  // Task non-sosial: ikon aksi generik dalam container muted.
  const generic = (() => {
    switch (t) {
      case "submit_email":
        return <Mail className="h-5 w-5" aria-hidden />;
      case "submit_party_id":
      case "submit_canton_address":
        return <Fingerprint className="h-5 w-5" aria-hidden />;
      case "daily_check_in":
        return <CalendarCheck className="h-5 w-5" aria-hidden />;
      case "quiz_yes_no":
      case "quiz_choice":
        return <HelpCircle className="h-5 w-5" aria-hidden />;
      default:
        return <HelpCircle className="h-5 w-5" aria-hidden />;
    }
  })();

  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--muted)] text-canton ring-1 ring-white/5",
        className,
      )}
    >
      {generic}
    </span>
  );
}

function ActionGlyphOverlay({ type }: { type: string }) {
  const glyph = <ActionGlyph type={type} />;
  if (!glyph) return null;
  return (
    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--card)]">
      {glyph}
    </span>
  );
}
