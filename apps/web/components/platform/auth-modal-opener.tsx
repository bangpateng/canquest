"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthModal } from "@/components/platform/auth-context";

/** Opens auth modal when landing URL has ?auth=login|register&next=... */
export function AuthModalOpener() {
  const searchParams = useSearchParams();
  const { openAuth } = useAuthModal();

  useEffect(() => {
    const auth = searchParams.get("auth");
    const next = searchParams.get("next");
    if (auth === "login" || auth === "register") {
      openAuth(auth, next);
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      if (next) url.searchParams.delete("next");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [searchParams, openAuth]);

  return null;
}
