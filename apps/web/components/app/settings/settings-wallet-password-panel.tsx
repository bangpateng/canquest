"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { KeyRound, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/utils";

type Mode = "view" | "set" | "change" | "remove";

const MIN_LEN = 8;
const MAX_LEN = 64;

export function SettingsWalletPasswordPanel() {
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/party/wallet-password", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { hasPassword?: boolean };
        setHasPassword(!!data.hasPassword);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setShow(false);
    setError(null);
  }

  function enterMode(m: Mode) {
    resetForm();
    setSuccess(null);
    setMode(m);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (mode === "set" || mode === "change") {
      if (next.length < MIN_LEN || next.length > MAX_LEN) {
        setError(`Wallet password must be ${MIN_LEN}–${MAX_LEN} characters.`);
        return;
      }
      if (next !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "set" || mode === "change") {
        const res = await fetch("/api/party/wallet-password", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "change"
              ? { currentPassword: current, newPassword: next }
              : { newPassword: next },
          ),
        });
        const raw = (await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (!res.ok) {
          setError(formatApiError(raw));
          return;
        }
        setHasPassword(true);
        setSuccess(
          mode === "change"
            ? "Wallet password updated."
            : "Wallet password enabled.",
        );
      } else {
        // remove
        const res = await fetch("/api/party/wallet-password", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: current }),
        });
        const raw = (await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (!res.ok) {
          setError(formatApiError(raw));
          return;
        }
        setHasPassword(false);
        setSuccess("Wallet password disabled.");
      }
      resetForm();
      setMode("view");
      await load();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="wallet-password"
      className="scroll-mt-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50"
    >
      {/* Section Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            Wallet Password
          </span>
          <p className="mt-1 text-xs text-slate-500">
            Optional extra password required for Send, Lock &amp; Unlock
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <LoadingSpinner size="sm" tone="muted" />
            Checking status…
          </div>
        ) : mode === "view" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  hasPassword
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-white/5 text-slate-500",
                )}
              >
                {hasPassword ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider",
                    hasPassword ? "text-emerald-300/80" : "text-slate-500",
                  )}
                >
                  {hasPassword ? "Enabled" : "Disabled"}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-300">
                  {hasPassword
                    ? "Send, Lock & Unlock require this password"
                    : "No extra password — funds move with login only"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => enterMode(hasPassword ? "change" : "set")}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              {hasPassword ? "Change" : "Set password"}
            </button>
            {hasPassword ? (
              <button
                type="button"
                onClick={() => enterMode("remove")}
                className="text-xs font-semibold text-red-400 hover:underline"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                {mode === "set" && "Set wallet password"}
                {mode === "change" && "Change wallet password"}
                {mode === "remove" && "Remove wallet password"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setMode("view");
                }}
                className="text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>

            {(mode === "change" || mode === "remove") && (
              <Field
                label="Current wallet password"
                value={current}
                onChange={setCurrent}
                show={show}
                onToggleShow={() => setShow((s) => !s)}
                disabled={busy}
                autoFocus
              />
            )}

            {(mode === "set" || mode === "change") && (
              <>
                <Field
                  label={`New wallet password (${MIN_LEN}–${MAX_LEN} chars)`}
                  value={next}
                  onChange={setNext}
                  show={show}
                  onToggleShow={() => setShow((s) => !s)}
                  disabled={busy}
                  autoFocus={mode === "set"}
                />
                <Field
                  label="Confirm new password"
                  value={confirm}
                  onChange={setConfirm}
                  show={show}
                  onToggleShow={() => setShow((s) => !s)}
                  disabled={busy}
                />
              </>
            )}

            {error ? (
              <p
                className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                buttonVariants({ size: "sm" }),
                mode === "remove" && "bg-red-600 hover:bg-red-500",
              )}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <LoadingSpinner size="sm" /> Saving…
                </span>
              ) : mode === "remove" ? (
                "Remove password"
              ) : (
                "Save password"
              )}
            </button>
          </form>
        )}

        {/* Success */}
        {success && mode === "view" ? (
          <p className="mt-4 text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  show,
  onToggleShow,
  disabled,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-slate-500 sm:text-sm">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={MAX_LEN}
          className="w-full rounded-xl border border-white/[0.08] bg-[#0a0c14]/80 px-4 py-2.5 pr-11 text-sm font-medium text-white outline-none transition-all duration-200 focus:border-[var(--primary)]/30 focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onToggleShow}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-200"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
