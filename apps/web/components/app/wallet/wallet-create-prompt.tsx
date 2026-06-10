"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Sparkles, Ticket, Wallet, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

const WALLET_FEATURES = [
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
        "rounded-xl border border-orange-500/20 bg-orange-500/5 p-5 sm:p-6",
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
      <div className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-2xl p-2 text-slate-400 transition-colors hover:bg-[var(--muted)] hover:text-slate-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
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
    <div className={cn(isModal ? "pt-2" : "")}>
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500/15 ring-1 ring-orange-500/25">
          <Wallet className="h-6 w-6 text-orange-300" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pr-8">
          <p id="wallet-create-prompt-title" className="text-lg font-bold text-orange-100">
            Create your wallet first
          </p>
          <p className="mt-2 text-sm font-medium text-orange-200/85">
            Needed for Earn campaigns and Spin Reward.
          </p>
        </div>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {WALLET_FEATURES.map(({ icon: Icon, label, desc }) => (
          <li
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[var(--background)]/50 px-4 py-3"
          >
            <Icon className="h-5 w-5 shrink-0 text-canton" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">{label}</p>
              <p className="text-xs font-medium text-slate-400">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className={cn("mt-6 flex flex-wrap gap-3", isModal && "sm:justify-end")}>
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
        {isModal ? (
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "rounded-2xl text-slate-400",
            )}
          >
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
