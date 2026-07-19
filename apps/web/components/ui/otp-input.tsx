"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from "react";
import { cn } from "@/lib/utils/utils";
import { inputClass } from "@/lib/ui/ui-tokens";

/**
 * 6-box OTP input. Auto-focus box pertama saat mount, auto-advance saat user
 * mengetik, backspace pindah ke box sebelumnya. Mendukung paste 6 digit
 * sekaligus (dari password manager / SMS autofill).
 *
 * Ref pattern: cc-lock-modal formatCountdown, auth-modal inline OTP input.
 * Upgrade: split per-digit box supaya UX lebih baik (visual + a11y).
 *
 * Controlled component: parent pegang state `value` (string 6 digit) via
 * `onChange`. Setelah semua 6 box terisi, parent bisa auto-submit (opsional).
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  length = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (final: string) => void;
  disabled?: boolean;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);

  // Auto-focus box pertama saat mount.
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function setDigitAt(index: number, digit: string) {
    const sanitized = digit.replace(/[^0-9]/g, "").slice(-1);
    const chars = value.padEnd(length, " ").split("");
    chars[index] = sanitized || " ";
    const next = chars.join("").replace(/\s/g, "");
    onChange(next);

    // Auto-advance ke box berikutnya kalau digit diisi.
    if (sanitized && index < length - 1) {
      refs.current[index + 1]?.focus();
      refs.current[index + 1]?.select();
    }

    // Trigger onComplete kalau semua box terisi.
    if (next.length === length && onComplete) {
      onComplete(next);
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.padEnd(length, " ").split("");
      if (chars[index] && chars[index].trim() !== "") {
        // Hapus digit saat ini.
        chars[index] = " ";
        onChange(chars.join("").replace(/\s/g, ""));
      } else if (index > 0) {
        // Box kosong + backspace → pindah ke sebelumnya + hapus situ.
        const prev = index - 1;
        chars[prev] = " ";
        onChange(chars.join("").replace(/\s/g, ""));
        refs.current[prev]?.focus();
        refs.current[prev]?.select();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
      refs.current[index - 1]?.select();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
      refs.current[index + 1]?.select();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    const lastIdx = Math.min(pasted.length, length) - 1;
    refs.current[lastIdx]?.focus();
    refs.current[lastIdx]?.select();
    if (pasted.length === length && onComplete) onComplete(pasted);
  }

  return (
    <div
      className="flex justify-center gap-2"
      role="group"
      aria-label="6-digit verification code"
    >
      {Array.from({ length }).map((_, i) => {
        const digit = value[i] ?? "";
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={disabled}
            onFocus={(e) => {
              setFocused(i);
              e.currentTarget.select();
            }}
            onBlur={() => setFocused(null)}
            onChange={(e) => setDigitAt(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            aria-label={`Digit ${i + 1}`}
            className={cn(
              inputClass,
              "h-14 w-12 text-center text-2xl font-bold",
              focused === i && "ring-2 ring-emerald-400",
            )}
          />
        );
      })}
    </div>
  );
}
