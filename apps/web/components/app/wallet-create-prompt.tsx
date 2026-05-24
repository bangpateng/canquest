"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Gift, Sparkles, Ticket, Wallet, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Gift, label: "Quest", desc: "Daily tasks & points" },
  { icon: Sparkles, label: "Earn", desc: "Partner campaigns" },
  { icon: Ticket, label: "Spin Reward", desc: "Spend points, win CC" },
] as const;

type WalletCreatePromptProps = {
  className?: string;
};

export function WalletCreatePromptBanner({ className }: WalletCreatePromptProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-orange-500/30 bg-orange-500/10 p-5 sm:p-6",
        className,
      )}
      role="status"
    >
      <WalletCreatePromptContent variant="banner" />
    </div>
  );
}

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
      <div className="relative w-full max-w-md rounded-2xl border border-orange-500/25 bg-[var(--card)] p-6 shadow-2xl shadow-black/40">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <WalletCreatePromptContent variant="modal" onDismiss={onClose} />
      </div>
    </div>
  );
}

function WalletCreatePromptContent({
  variant,
  onDismiss,
}: {
  variant: "banner" | "modal";
  onDismiss?: () => void;
}) {
  const isModal = variant === "modal";

  return (
    <div className={cn(isModal ? "pt-1" : "")}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-500/25">
          <Wallet className="h-5 w-5 text-orange-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pr-6">
          <p
            id="wallet-create-prompt-title"
            className="font-semibold text-orange-100"
          >
            Create your wallet first
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-orange-200/85">
            You need a Canton wallet on CanQuest before you can earn points. Create one
            to unlock:
          </p>
        </div>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, label, desc }) => (
          <li
            key={label}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)]/50 px-3 py-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-canton" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
              <p className="text-[10px] text-[var(--muted-foreground)]">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        Choose a username on the Wallet page — your party is created in one step.
      </p>

      <div className={cn("mt-4 flex flex-wrap gap-2", isModal && "sm:justify-end")}>
        <Link
          href="/wallet"
          onClick={onDismiss}
          className={cn(
            buttonVariants({ size: "sm" }),
            "gap-2 rounded-full bg-canton text-[var(--primary-foreground)] hover:bg-canton/90",
          )}
        >
          <Wallet className="h-4 w-4" />
          Create wallet
        </Link>
        {isModal ? (
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "rounded-full text-[var(--muted-foreground)]",
            )}
          >
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
