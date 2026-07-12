"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AlertCircle, Lock, X } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { WalletPasswordModal } from "@/components/app/wallet/wallet-password-modal";
import { useWalletPassword } from "@/lib/hooks/use-wallet-password";
import { cn } from "@/lib/utils/utils";
import type { ActiveLock, LockStatus } from "@/lib/hooks/use-lock-status";

/** Render termKey (mis. "15d"/"5m") jadi label manusiawi untuk tombol aksi. */
function termLabel(termKey: string): string {
  const m = termKey.match(/^(\d+)([smhd])$/i);
  if (!m) return termKey;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "s") return `${n} second`;
  if (unit === "m") return `${n} minutes`;
  if (unit === "h") return `${n} hours`;
  return `${n} day`;
}

interface CcLockModalProps {
  open: boolean;
  onClose: () => void;
  status: LockStatus;
  /** Refresh status setelah lock/unlock berhasil. */
  onRefresh: () => (() => void) | void;
}

interface TermOption {
  key: string;
  seconds: number;
  label: string;
}

export function CcLockModal({ open, onClose, status, onRefresh }: CcLockModalProps) {
  const titleId = useId();
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [amount, setAmount] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [lockState, setLockState] = useState<"idle" | "loading" | "error">("idle");
  const [lockMessage, setLockMessage] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Gate kata sandi transaksi (opsional). pendingAction diset saat user klik
  // Lock/Unlock tetapi wallet password aktif — dijalankan setelah konfirmasi modal.
  const { hasPassword: hasWalletPassword } = useWalletPassword();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pendingAction, setPendingAction] = useState<
    ((password: string) => void) | null
  >(null);

  // Fetch lock-terms sekali saat modal dibuka.
  useEffect(() => {
    if (!open) return;
    fetch("/api/party/lock-terms", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { terms?: TermOption[] } | null) => {
        const opts = d?.terms ?? [];
        setTerms(opts);
        if (opts.length > 0 && !selectedTerm) setSelectedTerm(opts[0].key);
      })
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown tick tiap detik (frontend-only per spec BAGIAN 5c).
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // Reset state saat modal ditutup.
  useEffect(() => {
    if (!open) {
      setLockState("idle");
      setLockMessage("");
      setAmount("");
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const numericAmount = parseFloat(amount.trim());
  const amountValid =
    Number.isFinite(numericAmount) && numericAmount > 0 &&
    (status.availableCc == null || numericAmount <= status.availableCc);

  const submitLock = useCallback(
    async (e: React.FormEvent, password?: string) => {
      e.preventDefault();
      if (!selectedTerm || !amountValid) return;
      // Gate: bila wallet password aktif dan belum ada input, tahan di modal.
      if (hasWalletPassword && !password) {
        setPwError("");
        setPendingAction(() => (pw: string) => void submitLock(e, pw));
        setPwOpen(true);
        return;
      }
      setLockState("loading");
      setLockMessage("");
      try {
        const res = await fetch("/api/party/lock", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCc: numericAmount,
            termKey: selectedTerm,
            ...(password ? { walletPassword: password } : {}),
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          // 403 = wallet password salah — tetap di modal untuk coba lagi.
          if (res.status === 403) {
            setPwOpen(true);
            setPwError(data.error ?? "Wrong wallet password.");
            setLockState("idle");
            return;
          }
          setLockState("error");
          setLockMessage(data.error ?? "Lock failed. Please try again.");
          return;
        }
        setLockState("idle");
        setLockMessage("");
        setPwOpen(false);
        setPendingAction(null);
        setAmount("");
        onRefresh();
      } catch {
        setLockState("error");
        setLockMessage("Network error. Check your connection.");
      }
    },
    [selectedTerm, amountValid, numericAmount, onRefresh, hasWalletPassword],
  );

  const submitUnlock = useCallback(
    async (lockId: string, password?: string) => {
      // Gate: bila wallet password aktif dan belum ada input, tahan di modal.
      if (hasWalletPassword && !password) {
        setPwError("");
        setPendingAction(() => (pw: string) => void submitUnlock(lockId, pw));
        setPwOpen(true);
        return;
      }
      setUnlockingId(lockId);
      try {
        const res = await fetch("/api/party/unlock", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lockId,
            ...(password ? { walletPassword: password } : {}),
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          // 403 = wallet password salah — tetap di modal untuk coba lagi.
          if (res.status === 403) {
            setPwOpen(true);
            setPwError(data.error ?? "Wrong wallet password.");
            return;
          }
          setLockState("error");
          setLockMessage(data.error ?? "Unlock failed.");
        } else {
          setPwOpen(false);
          setPendingAction(null);
          onRefresh();
        }
      } catch {
        setLockState("error");
        setLockMessage("Network error.");
      } finally {
        setUnlockingId(null);
      }
    },
    [onRefresh, hasWalletPassword],
  );

  // Konfirmasi password dari modal → jalankan aksi tertunda (lock/unlock).
  function confirmWalletPassword(password: string) {
    setPwError("");
    const action = pendingAction;
    if (action) action(password);
  }

  function closePasswordModal() {
    setPwOpen(false);
    setPwError("");
    setPendingAction(null);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-6 sm:p-8 shadow-xl"
      >
        {/* Drag handle (mobile bottom-sheet feel) */}

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-emerald-400" aria-hidden />
            <h2 id={titleId} className="text-xl font-bold text-slate-100">Lock</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Bagian ATAS: buat lock baru ── */}
        <form onSubmit={submitLock} className="mt-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="cc-lock-amount" className="text-sm font-medium text-slate-400">
                Amount
              </label>
              {status.availableCc != null && status.availableCc > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(status.availableCc!.toFixed(4))}
                  disabled={lockState === "loading"}
                  className="text-xs font-semibold text-emerald-400 hover:underline disabled:opacity-40"
                >
                  MAX
                </button>
              )}
            </div>
            <input
              id="cc-lock-amount"
              required
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 30"
              disabled={lockState === "loading"}
              className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-base font-bold tabular-nums text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
            />
            <p className="text-xs text-slate-500">Lock 30 CC to unlock Earn campaigns.</p>
          </div>

          {/* Pilihan durasi — di-render dari GET /lock-terms, BUKAN hard-code */}
          {terms.length > 0 ? (
            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-400">Duration</span>
              <div className="grid grid-cols-3 gap-2">
                {terms.map((t) => {
                  const active = selectedTerm === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSelectedTerm(t.key)}
                      disabled={lockState === "loading"}
                      className={cn(
                        "rounded-2xl border px-3 py-2.5 text-sm font-semibold transition-all disabled:opacity-50",
                        active
                          ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                          : "border-white/10 text-slate-400 bg-white/5 hover:text-slate-200",
                      )}
                    >
                      {termLabel(t.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Loading duration options…</p>
          )}

          {lockState === "error" && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm font-medium text-red-400">{lockMessage}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={lockState === "loading" || !amountValid || !selectedTerm}
            className={cn(buttonVariants({ size: "sm" }), "w-full gap-2")}
          >
            {lockState === "loading" ? (
              <>
                <LoadingSpinner size="sm" /> Lock…
              </>
            ) : (
              amountValid && selectedTerm
                ? `Lock ${numericAmount} CC for ${termLabel(selectedTerm)}`
                : "Lock"
            )}
          </button>
          <p className="text-center text-xs text-slate-500">
            CC remains yours, with full return upon unlocking; a small network fee (holding fee) applies while locked
          </p>
        </form>

        {/* ── Bagian BAWAH: kelola lock aktif ── */}
        {status.activeLocks.length > 0 && (
          <div className="mt-7 border-t border-white/5 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">Lock active</h3>
            <ul className="space-y-3">
              {status.activeLocks.map((lock) => (
                <ActiveLockRow
                  key={lock.id}
                  lock={lock}
                  now={now}
                  unlocking={unlockingId === lock.id}
                  onUnlock={() => void submitUnlock(lock.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── WALLET PASSWORD GATE (Lock/Unlock) ── */}
      <WalletPasswordModal
        open={pwOpen}
        actionLabel={pendingAction ? "Unlock" : "Lock"}
        error={pwError}
        busy={lockState === "loading" || unlockingId !== null}
        onClose={closePasswordModal}
        onConfirm={confirmWalletPassword}
      />
    </div>
  );
}

function ActiveLockRow({
  lock,
  now,
  unlocking,
  onUnlock,
}: {
  lock: ActiveLock;
  now: number;
  unlocking: boolean;
  onUnlock: () => void;
}) {
  const expiresMs = Date.parse(lock.expiresAt);
  const ready = Number.isFinite(expiresMs) && now >= expiresMs;
  const remainingMs = Math.max(0, expiresMs - now);

  // Format countdown dd/hh/mm/ss (frontend-only).
  const countdown = formatCountdown(remainingMs);

  return (
    <li className="rounded-2xl border border-white/5 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">
            {lock.amountCc} CC · {termLabel(lock.termKey)}
          </p>
          <p className={cn("text-xs font-medium", ready ? "text-emerald-400" : "text-slate-500")}>
            {ready ? "Unlocked" : `Unlock ${countdown}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onUnlock}
          disabled={!ready || unlocking}
          className={cn(
            "shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed",
            ready
              ? "bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-60"
              : "bg-white/5 text-slate-500 opacity-60",
          )}
        >
          {unlocking ? <LoadingSpinner size="sm" /> : "Unlock"}
        </button>
      </div>
    </li>
  );
}

/** Format milliseconds → "Xd Yh Zm" / "Yh Zm Ws" / "Zs" (compact). */
function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
