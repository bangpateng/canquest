"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  Bell,
  Gift,
  X,
} from "lucide-react";
import { iconButtonClass } from "@/lib/ui-button-styles";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import {
  useTransactionNotifications,
  type NotificationTx,
} from "@/lib/hooks/use-transaction-notifications";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

function timeAgo(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minutesAgo", { n: mins });
  if (hours < 24) return t("time.hoursAgo", { n: hours });
  if (days === 1) return t("time.yesterday");
  return t("time.daysAgo", { n: days });
}

function txLabel(
  tx: NotificationTx,
  t: (key: string) => string,
): string {
  switch (tx.type) {
    case "QUEST_REWARD":
      return t("transactions.questReward");
    case "SPIN_REWARD":
      return t("transactions.spinReward");
    case "TRANSFER_IN":
      return t("transactions.receivedCc");
    default:
      return tx.description;
  }
}

function NotificationRow({
  tx,
}: {
  tx: NotificationTx;
}) {
  const t = usePlatformT();
  const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
  const title = tx.description?.trim() || txLabel(tx, t);

  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <Link
        href={`/transactions/${tx.id}`}
        className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--primary)]/8"
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            tx.type === "TRANSFER_IN"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-[var(--primary)]/15 text-[var(--foreground)]",
          )}
        >
          {tx.type === "TRANSFER_IN" ? (
            <ArrowDownLeft className="h-4 w-4" aria-hidden />
          ) : (
            <Gift className="h-4 w-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--foreground)]">
            {title}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
            {txLabel(tx, t)} · {timeAgo(tx.createdAt, t)}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-green-600 dark:text-green-400">
          +{ccAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} CC
        </span>
      </Link>
    </li>
  );
}

export function TransactionNotifications() {
  const t = usePlatformT();
  const { feed, loading, toasts, dismissToast, markSeen } =
    useTransactionNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = feed?.unreadCount ?? 0;

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const markedThisOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      markedThisOpen.current = false;
      return;
    }
    if (markedThisOpen.current) return;
    markedThisOpen.current = true;
    void markSeen();
  }, [open, markSeen]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => dismissToast(toast.id), 6_000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismissToast]);

  function toastMessage(toast: (typeof toasts)[number]) {
    const amount = toast.amountCc.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
    if (toast.type === "QUEST_REWARD") {
      return t("notifications.toastEarn", { amount });
    }
    if (toast.type === "SPIN_REWARD") {
      return t("notifications.toastSpin", { amount });
    }
    return t("notifications.toastReceived", { amount });
  }

  return (
    <>
      <div className="relative" ref={panelRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(iconButtonClass("relative h-9 w-9"))}
          aria-label={t("notifications.aria")}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label={t("notifications.title")}
            className="absolute right-0 top-full z-50 mt-1.5 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {t("notifications.title")}
              </p>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void markSeen()}
                  className="text-xs font-medium text-[var(--primary)] hover:underline"
                >
                  {t("notifications.markRead")}
                </button>
              ) : null}
            </div>

            {loading && !feed ? (
              <div className="flex justify-center py-10">
                <LoadingSpinner size="md" />
              </div>
            ) : !feed?.items.length ? (
              <p className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                {t("notifications.empty")}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {feed.items.map((tx) => (
                  <NotificationRow key={tx.id} tx={tx} />
                ))}
              </ul>
            )}

            <div className="border-t border-[var(--border)] px-3 py-2">
              <Link
                href="/wallet"
                onClick={() => setOpen(false)}
                className="block text-center text-xs font-medium text-[var(--primary)] hover:underline"
              >
                {t("notifications.viewWallet")}
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 shadow-lg"
          >
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            <p className="min-w-0 flex-1 text-sm text-[var(--foreground)]">
              {toastMessage(toast)}
            </p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
