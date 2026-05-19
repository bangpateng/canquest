"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleSignOut}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0", className)}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
