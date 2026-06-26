"use client";

import { cn } from "@/lib/utils/utils";
import {
  CalendarCheck,
  HelpCircle,
  Mail,
  Fingerprint,
  UserPlus,
  Repeat2,
  Send,
  SendHorizonal,
  Users,
} from "lucide-react";

/**
 * Ikon task — gaya sederhana (bukan logo brand berwarna). Satu ikon generik
 * per tipe task, dalam container muted netral. Verified = badge check hijau.
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
  if (complete) {
    return (
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
          className,
        )}
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  const cls = "h-5 w-5";
  let glyph: React.ReactNode;
  switch (type) {
    case "twitter_follow":
      glyph = <UserPlus className={cls} aria-hidden />;
      break;
    case "twitter_retweet":
      glyph = <Repeat2 className={cls} aria-hidden />;
      break;
    case "telegram_channel":
    case "telegram_group":
    case "telegram_join":
      glyph = <Send className={cls} aria-hidden />;
      break;
    case "discord_join":
      glyph = <Users className={cls} aria-hidden />;
      break;
    case "submit_email":
      glyph = <Mail className={cls} aria-hidden />;
      break;
    case "submit_party_id":
    case "submit_canton_address":
      glyph = <Fingerprint className={cls} aria-hidden />;
      break;
    case "daily_check_in":
      glyph = <CalendarCheck className={cls} aria-hidden />;
      break;
    case "send_transaction":
      glyph = <SendHorizonal className={cls} aria-hidden />;
      break;
    case "quiz_yes_no":
    case "quiz_choice":
      glyph = <HelpCircle className={cls} aria-hidden />;
      break;
    default:
      glyph = <HelpCircle className={cls} aria-hidden />;
  }

  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--muted)] text-slate-400 ring-1 ring-white/5",
        className,
      )}
    >
      {glyph}
    </span>
  );
}
