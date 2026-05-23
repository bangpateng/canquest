"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type SignOutButtonProps = {
  className?: string;
  /** Plain red text link — used at the bottom of Settings. */
  variant?: "button" | "link";
};

export function SignOutButton({ className, variant = "button" }: SignOutButtonProps) {
  const t = usePlatformT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleSignOut}
      className={cn(
        variant === "link"
          ? "text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
          : cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0"),
        className,
      )}
    >
      {busy ? t("settings.signingOut") : t("settings.signOut")}
    </button>
  );
}
