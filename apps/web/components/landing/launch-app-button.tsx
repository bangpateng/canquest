"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useAuthModal } from "@/components/platform/auth-context";
import { cn } from "@/lib/utils";

type LaunchAppButtonProps = {
  size?: "sm" | "lg";
  className?: string;
  showArrow?: boolean;
};

/** One CTA: logged in → /overview; guest → auth modal (login/register). */
export function LaunchAppButton({
  size = "sm",
  className,
  showArrow = false,
}: LaunchAppButtonProps) {
  const { openAuth } = useAuthModal();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then((r) => {
        if (!cancelled) setAuthed(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = "Launch App";
  const classes = cn(
    buttonVariants({ size }),
    showArrow && "gap-2",
    size === "lg" && showArrow && "neon-border",
    className,
  );

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
        {showArrow && <ArrowRight className="h-4 w-4" />}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={() => openAuth("login", "/overview")}
    >
      {label}
      {showArrow && <ArrowRight className="h-4 w-4" />}
    </button>
  );
}
