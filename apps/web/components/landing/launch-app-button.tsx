"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useAuthModal } from "@/components/platform/auth-context";
import { cn } from "@/lib/utils/utils";

type LaunchAppButtonProps = {
  size?: "sm" | "lg";
  className?: string;
};

/** One CTA: logged in → /overview; guest → auth modal (login/register). */
export function LaunchAppButton({ size = "sm", className }: LaunchAppButtonProps) {
  const { openAuth } = useAuthModal();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        if (cancelled || !r.ok) {
          if (!cancelled) setAuthed(false);
          return;
        }
        const data = (await r.json()) as { loggedIn?: boolean };
        if (!cancelled) setAuthed(Boolean(data.loggedIn));
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = "Launch App";
  const classes = cn(buttonVariants({ size }), className);

  if (authed === null) {
    return (
      <span className={cn(classes, "pointer-events-none opacity-60")} aria-hidden>
        {label}
      </span>
    );
  }

  if (authed) {
    return (
      <Link href="/overview" className={classes}>
        {label}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} onClick={() => openAuth("login", "/overview")}>
      {label}
    </button>
  );
}
