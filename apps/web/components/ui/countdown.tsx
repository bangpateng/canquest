"use client";

import { useEffect, useState } from "react";

/**
 * Countdown timer. Display `mm:ss` sampai `expiresAt` lewat.
 *
 * - Setiap detik menghitung sisa waktu dari `expiresAt - Date.now()`.
 * - Saat `<= 0`: panggil `onExpire` sekali + tampilkan "00:00".
 *
 * Ref pattern: cc-lock-modal formatCountdown inline. Di-extract ke sini
 * supaya reusable untuk OTP modal (Fase 1.5.2) dan lock modal (future).
 */
export function Countdown({
  expiresAt,
  onExpire,
  className,
}: {
  expiresAt: Date | string;
  onExpire?: () => void;
  className?: string;
}) {
  const targetMs = new Date(expiresAt).getTime();
  const [remainingMs, setRemainingMs] = useState(
    Math.max(0, targetMs - Date.now()),
  );

  useEffect(() => {
    // Recompute tiap detik.
    const interval = setInterval(() => {
      const next = Math.max(0, targetMs - Date.now());
      setRemainingMs(next);
      if (next <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    // Initial sync supaya tidak flash nilai lama.
    setRemainingMs(Math.max(0, targetMs - Date.now()));

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs]);

  const totalSec = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isExpired = remainingMs <= 0;

  return (
    <span
      className={className}
      role="timer"
      aria-live="polite"
      data-expired={isExpired ? "true" : "false"}
    >
      {isExpired ? "Expired" : formatted}
    </span>
  );
}
