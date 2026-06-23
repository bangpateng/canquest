"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Gift,
  Lock,
  LockOpen,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import {
  useTransactionNotifications,
  type NotificationItem,
  type NotificationTx,
} from "@/lib/hooks/use-transaction-notifications";
import { ROUTES } from "@/lib/routing/app-routes";
import { cn } from "@/lib/utils/utils";
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
    case "TRANSFER_OUT":
      return t("transactions.sentCc");
    case "CC_LOCK":
      return t("transactions.ccLocked");
    case "CC_UNLOCK":
      return t("transactions.ccUnlocked");
    default:
      return tx.description;
  }
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const t = usePlatformT();

  if (item.kind === "draw") {
    const isWin = item.drawKind === "win";
    return (
      <li className="border-b border-[var(--border)] last:border-b-0">
        <Link
          href={ROUTES.campaignQuest(item.questId, item.questTitle)}
          className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--primary)]/8"
        >
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              isWin
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-[var(--muted)] text-[var(--muted-foreground)]",
            )}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--foreground)]">
              {item.description}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
              {item.questTitle} · {timeAgo(item.createdAt, t)}
            </span>
          </span>
          {isWin && item.rewardCc != null && item.rewardCc > 0 ? (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{item.rewardCc} CC
            </span>
          ) : null}
        </Link>
      </li>
    );
  }

  if (item.kind === "code") {
    return (
      <li className="border-b border-[var(--border)] last:border-b-0">
        <Link
          href={ROUTES.campaignQuest(item.questId, item.questTitle)}
          className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--primary)]/8"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300">
            <Ticket className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--foreground)]">
              {item.description}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
              {item.questTitle} · {timeAgo(item.createdAt, t)}
            </span>
            <span className="mt-1 block truncate font-mono text-xs text-[var(--foreground)]">
              {item.code}
            </span>
          </span>
        </Link>
      </li>
    );
  }

  const tx = item;
  const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
  const title = tx.description?.trim() || txLabel(tx, t);
  // Arah: TRANSFER_OUT & CC_LOCK = keluar (−), sisanya = masuk (+).
  const isDebit = tx.type === "TRANSFER_OUT" || tx.type === "CC_LOCK";

  const iconClass = cn(
    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
    tx.type === "TRANSFER_IN"
      ? "bg-green-500/10 text-green-600 dark:text-green-400"
      : tx.type === "TRANSFER_OUT"
        ? "bg-red-500/10 text-red-600 dark:text-red-400"
        : tx.type === "CC_LOCK"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : tx.type === "CC_UNLOCK"
            ? "bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-[var(--primary)]/15 text-[var(--foreground)]",
  );

  const amountClass = cn(
    "shrink-0 text-sm font-semibold tabular-nums",
    isDebit
      ? "text-red-600 dark:text-red-400"
      : "text-green-600 dark:text-green-400",
  );

  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <Link
        href={`/transactions/${tx.id}`}
        className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--primary)]/8"
      >
        <span className={iconClass}>
          {tx.type === "TRANSFER_IN" ? (
            <ArrowDownLeft className="h-4 w-4" aria-hidden />
          ) : tx.type === "TRANSFER_OUT" ? (
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          ) : tx.type === "CC_LOCK" ? (
            <Lock className="h-4 w-4" aria-hidden />
          ) : tx.type === "CC_UNLOCK" ? (
            <LockOpen className="h-4 w-4" aria-hidden />
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
        <span className={amountClass}>
          {isDebit ? "\u2212" : "+"}
          {ccAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} CC
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  const unread = feed?.unreadCount ?? 0;

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const el = buttonRef.current;
    if (!el) return;

    const place = () => {
      const rect = el.getBoundingClientRect();
      const gap = 8;
      const top = Math.max(gap, rect.bottom + gap);
      const right = Math.max(gap, window.innerWidth - rect.right);
      setMenuStyle({
        position: "fixed",
        top,
        right,
        zIndex: 60,
        width: "min(calc(100vw - 1rem), 22rem)",
      });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

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

  /** Ikon + warna toast mengikuti jenis event (debit = merah, lock = amber, dsb). */
  function toastIcon(toast: (typeof toasts)[number]) {
    if (toast.kind === "draw") {
      return <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    }
    if (toast.kind === "code") {
      return <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />;
    }
    switch (toast.txType) {
      case "TRANSFER_OUT":
        return <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />;
      case "CC_LOCK":
        return <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />;
      case "CC_UNLOCK":
        return <LockOpen className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />;
      default:
        return <Gift className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />;
    }
  }

  function toastMessage(toast: (typeof toasts)[number]) {
    if (toast.kind === "draw" || toast.kind === "code") {
      return toast.description;
    }
    const amount = toast.amountCc.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
    switch (toast.txType) {
      case "QUEST_REWARD":
        return t("notifications.toastEarn", { amount });
      case "SPIN_REWARD":
        return t("notifications.toastSpin", { amount });
      case "TRANSFER_OUT":
        return t("notifications.toastSent", { amount });
      case "CC_LOCK":
        return t("notifications.toastLocked", { amount });
      case "CC_UNLOCK":
        return t("notifications.toastUnlocked", { amount });
      case "TRANSFER_IN":
      default:
        return t("notifications.toastReceived", { amount });
    }
  }

  return (
    <>
      <div className="relative" ref={panelRef}>
        <button
          ref={buttonRef}
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
            style={menuStyle ?? undefined}
            className={cn(
              "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg",
              menuStyle ? "" : "absolute right-0 top-full z-50 mt-1.5 w-[min(100vw-2rem,22rem)]",
            )}
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
                {feed.items.map((item) => (
                  <NotificationRow key={item.id} item={item} />
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
            {toastIcon(toast)}
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
