"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AlertCircle, Lock, X } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { TxReviewModal } from "@/components/app/wallet/tx-review-modal";
import { useMe } from "@/lib/hooks/use-me";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";
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
  const tx = useTransactionStatus();
  // M3b: user external (non-custodial) → lock/unlock di-sign di browser.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [amount, setAmount] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [lockState, setLockState] = useState<"idle" | "loading" | "error">("idle");
  const [lockMessage, setLockMessage] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // Tahap REVIEW (Input → Review → Sign → Broadcast → Success/Failed):
  // form Unlock/Lock tombol buka review dulu; eksekusi jalan saat Confirm.
  const [review, setReview] = useState<
    | { kind: "lock" }
    | { kind: "unlock"; lock: ActiveLock }
    | null
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

  // Form submit → buka tahap REVIEW (validasi dulu). Eksekusi di runLock().
  const submitLock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedTerm || !amountValid) return;
      setReview({ kind: "lock" });
    },
    [selectedTerm, amountValid],
  );

  const runLock = useCallback(async () => {
    if (!selectedTerm || !amountValid) return;
      setLockState("loading");
      setLockMessage("");
      // M3b: user external → sign di browser; tahap 'sign' menunggu passphrase.
      if (isExternalWallet) {
        try {
          await signRelayTransaction(
            "lock_cc",
            { amountCc: numericAmount, termKey: selectedTerm },
            {
              onWalletLocked: () =>
                promptPassphrase(`Lock ${numericAmount} CC (${termLabel(selectedTerm)})`),
            },
          );
          setLockState("idle");
          setLockMessage("");
          setAmount("");
          onRefresh();
          tx.succeed({
            amountText: `${numericAmount} CC`,
            title: "CC locked",
            subtitle: `Locked for ${termLabel(selectedTerm)}`,
            meta: [
              { label: "Amount", value: `${numericAmount} CC` },
              { label: "Duration", value: termLabel(selectedTerm) },
              { label: "Network", value: "Canton" },
            ],
          });
        } catch (err) {
          const msg =
            err instanceof Error && err.message
              ? err.message
              : "Lock failed. Please try again.";
          tx.fail(msg);
          setLockState("error");
          setLockMessage(msg);
        }
        return;
      }
      tx.startBroadcast({
        amountText: `${numericAmount} CC`,
        title: "CC locked",
        subtitle: `Locked for ${termLabel(selectedTerm)}`,
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
      });
      try {
        const res = await fetch("/api/party/lock", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCc: numericAmount,
            termKey: selectedTerm,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          const msg = data.error ?? "Lock failed. Please try again.";
          tx.fail(msg);
          setLockState("error");
          setLockMessage(msg);
          return;
        }
        setLockState("idle");
        setLockMessage("");
        setAmount("");
        onRefresh();
        tx.succeed({
          amountText: `${numericAmount} CC`,
          title: "CC locked",
          subtitle: `Locked for ${termLabel(selectedTerm)}`,
          meta: [
            { label: "Amount", value: `${numericAmount} CC` },
            { label: "Duration", value: termLabel(selectedTerm) },
            { label: "Network", value: "Canton" },
          ],
        });
      } catch {
        tx.fail("Network error. Check your connection.");
        setLockState("error");
        setLockMessage("Network error. Check your connection.");
      }
  },
    [selectedTerm, amountValid, numericAmount, onRefresh, tx, isExternalWallet, promptPassphrase],
  );

  // Tombol Unlock → buka tahap REVIEW dulu. Eksekusi di runUnlock().
  const submitUnlock = useCallback(
    async (lockId: string) => {
      const lock = status.activeLocks.find((l) => l.id === lockId);
      if (!lock) return;
      setReview({ kind: "unlock", lock });
    },
    [status.activeLocks],
  );

  const runUnlock = useCallback(
    async (lockId: string) => {
      const lock = status.activeLocks.find((l) => l.id === lockId);
      setUnlockingId(lockId);
      // M3b: user external → sign di browser.
      if (isExternalWallet) {
        try {
          await signRelayTransaction(
            "unlock_cc",
            { lockId },
            {
              onWalletLocked: () =>
                promptPassphrase(
                  lock ? `Unlock ${lock.amountCc} CC` : "Unlock CC",
                ),
            },
          );
          onRefresh();
          tx.succeed({
            amountText: lock ? `${lock.amountCc} CC` : "CC",
            title: "CC unlocked",
            subtitle: "Funds returned to your wallet.",
            meta: lock
              ? [
                  { label: "Amount", value: `${lock.amountCc} CC` },
                  { label: "Network", value: "Canton" },
                ]
              : undefined,
          });
        } catch (err) {
          const msg =
            err instanceof Error && err.message ? err.message : "Unlock failed.";
          tx.fail(msg);
          setLockState("error");
          setLockMessage(msg);
        } finally {
          setUnlockingId(null);
        }
        return;
      }
      tx.startBroadcast({
        amountText: lock ? `${lock.amountCc} CC` : "CC",
        title: "CC unlocked",
        subtitle: "Funds returned to your wallet.",
        accentBg: "bg-[var(--primary)]/15",
        accentText: "text-canton",
      });
      try {
        const res = await fetch("/api/party/unlock", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockId }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          const msg = data.error ?? "Unlock failed.";
          tx.fail(msg);
          setLockState("error");
          setLockMessage(msg);
        } else {
          onRefresh();
          tx.succeed({
            amountText: lock ? `${lock.amountCc} CC` : "CC",
            title: "CC unlocked",
            subtitle: "Funds returned to your wallet.",
            meta: lock
              ? [
                  { label: "Amount", value: `${lock.amountCc} CC` },
                  { label: "Network", value: "Canton" },
                ]
              : undefined,
          });
        }
      } catch {
        tx.fail("Network error.");
        setLockState("error");
        setLockMessage("Network error.");
      } finally {
        setUnlockingId(null);
      }
    },
    [onRefresh, status.activeLocks, tx, isExternalWallet, promptPassphrase],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      role="presentation"
    >
      {/* M3b: prompt passphrase untuk sign lock/unlock (user external). */}
      {passphraseModal}

      {/* Tahap REVIEW sebelum eksekusi (Input → Review → Sign → Broadcast). */}
      <TxReviewModal
        open={review !== null}
        title={review?.kind === "unlock" ? "Confirm unlock" : "Confirm lock"}
        amountText={
          review?.kind === "unlock"
            ? `Unlock ${review.lock.amountCc} CC`
            : `Lock ${numericAmount} CC`
        }
        subText={
          review?.kind === "unlock"
            ? "Funds return to your wallet"
            : `for ${termLabel(selectedTerm)}`
        }
        rows={
          review?.kind === "unlock"
            ? [
                { label: "Amount", value: `${review.lock.amountCc} CC` },
                { label: "Duration", value: termLabel(review.lock.termKey) },
                { label: "Network", value: "Canton" },
              ]
            : [
                { label: "Amount", value: `${numericAmount} CC` },
                { label: "Duration", value: termLabel(selectedTerm) },
                { label: "Network", value: "Canton" },
              ]
        }
        note={
          review?.kind === "unlock"
            ? undefined
            : "CC remains yours — a small holding fee applies while locked."
        }
        confirmLabel={review?.kind === "unlock" ? "Unlock" : "Lock"}
        onClose={() => setReview(null)}
        onConfirm={() => {
          const r = review;
          setReview(null);
          if (r?.kind === "unlock") void runUnlock(r.lock.id);
          else void runLock();
        }}
      />

      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-canton" aria-hidden />
            <h2 id={titleId} className="text-xl font-bold text-[var(--foreground)]">Lock</h2>
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
              <label htmlFor="cc-lock-amount" className="text-sm font-medium text-[var(--muted-foreground)]">
                Amount
              </label>
              {status.availableCc != null && status.availableCc > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(status.availableCc!.toFixed(4))}
                  disabled={lockState === "loading"}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto px-1 py-0 text-xs")}
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
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-base font-bold tabular-nums text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--canton-rgb)/0.40)] disabled:opacity-50"
            />
            <p className="text-xs text-[var(--muted-foreground)]">Lock 30 CC to unlock Earn campaigns.</p>
          </div>

          {/* Pilihan durasi — di-render dari GET /lock-terms, BUKAN hard-code */}
          {terms.length > 0 ? (
            <div className="space-y-2">
              <span className="text-sm font-medium text-[var(--muted-foreground)]">Duration</span>
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
                          ? "border-canton-muted bg-canton-subtle text-canton"
                          : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {termLabel(t.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">Loading duration options…</p>
          )}

          {lockState === "error" && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm font-medium text-red-600">{lockMessage}</p>
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
          <p className="text-center text-xs text-[var(--muted-foreground)]">
            CC remains yours, with full return upon unlocking; a small network fee (holding fee) applies while locked
          </p>
        </form>

        {/* ── Bagian BAWAH: kelola lock aktif ── */}
        {status.activeLocks.length > 0 && (
          <div className="mt-7 border-t border-[var(--border)] pt-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Lock active</h3>
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

  // v30 campaign lock (termKey "v30-…") vs savings lock — label pembeda
  // supaya jelas mana lock campaign (terbuka saat campaign berakhir) dan
  // mana tabungan pribadi berterm.
  const isCampaignLock = lock.termKey.startsWith("v30-");

  return (
    <li className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">
            {lock.amountCc} CC ·{" "}
            {isCampaignLock ? (
              <span className="text-canton">Campaign lock</span>
            ) : (
              termLabel(lock.termKey)
            )}
          </p>
          <p className={cn("text-xs font-medium", ready ? "text-canton" : "text-[var(--muted-foreground)]")}>
            {ready ? "Unlocked" : `Unlock ${countdown}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onUnlock}
          disabled={!ready || unlocking}
          className={cn(
            buttonVariants({ variant: ready ? "primary" : "muted", size: "sm" }),
            "shrink-0",
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
