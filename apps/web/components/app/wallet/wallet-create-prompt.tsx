"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Sparkles, Wallet, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";

const WALLET_FEATURES = [
  { icon: Sparkles, label: "Earn", desc: "Partner campaigns" },
  { icon: Wallet, label: "Wallet", desc: "Send & receive CC" },
] as const;

export function WalletCreatePromptModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-create-prompt-title"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <Card className="relative w-full max-w-md overflow-hidden p-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 0%, rgb(var(--canton-rgb) / 0.10), transparent 70%)",
          }}
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-2xl p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="relative">
          <WalletCreatePromptContent onDismiss={onClose} />
        </div>
      </Card>
    </div>
  );
}

function WalletCreatePromptContent({
  onDismiss,
}: {
  onDismiss?: () => void;
}) {
  return (
    <div className="pt-2">
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-canton-muted bg-canton-subtle">
          <Wallet className="h-6 w-6 text-canton" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pr-8">
          <p id="wallet-create-prompt-title" className="type-card-title text-[var(--foreground)]">
            Create your wallet first
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--muted-foreground)]">
            Needed to access Earn campaigns.
          </p>
        </div>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {WALLET_FEATURES.map(({ icon: Icon, label, desc }) => (
          <li
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/50 px-4 py-3"
          >
            <Icon className="h-5 w-5 shrink-0 text-canton" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--foreground)]">{label}</p>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-3 sm:justify-end">
        <Link
          href="/wallet"
          onClick={onDismiss}
          className={cn(
            buttonVariants({ size: "sm" }),
          )}
        >
          <Wallet className="h-5 w-5" />
          Create wallet
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            "rounded-2xl text-[var(--muted-foreground)]",
          )}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
