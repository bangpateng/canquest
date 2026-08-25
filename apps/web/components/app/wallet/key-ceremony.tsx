"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  KeyRound,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui/ui-tokens";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Card } from "@/components/ui/card";
import { CopyField } from "@/components/app/wallet/copy-field";
import {
  generateWalletKey,
  saveWalletKey,
  unlock,
  type WalletKeyMeta,
} from "@/lib/wallet/key-manager";

/**
 * Key ceremony — non-custodial wallet key creation (M1; used by M2 onboarding
 * and the M4 upgrade card).
 *
 * Steps (state machine):
 *   intro    → warning + start
 *   reveal   → raw hex 64-char key shown ONCE (copy + strong warning)
 *   verify   → user RETYPES THE FULL KEY from their saved copy (proves the
 *              backup is complete and correct — no position counting)
 *   pass     → set passphrase (x2) → store encrypted in IndexedDB
 *   done     → meta (party preview) + auto-unlock, calls onComplete
 *
 * The private key is never sent to the server by this component — onComplete
 * only carries meta (public key + party hint) for backend registration.
 *
 * UI tokens follow the Settings panel conventions (same Card, chip icons,
 * muted boxes, button variants) so the flow doesn't feel foreign in Settings.
 */

type Step = "intro" | "reveal" | "verify" | "pass" | "done";

export interface KeyCeremonyProps {
  /** Called after the key is stored & unlocked in this session. */
  onComplete: (meta: WalletKeyMeta) => void;
  /** Optional: back button on the intro step. */
  onCancel?: () => void;
}

export function KeyCeremony({ onComplete, onCancel }: KeyCeremonyProps) {
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [meta, setMeta] = useState<WalletKeyMeta | null>(null);
  const [retyped, setRetyped] = useState("");

  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [showPass, setShowPass] = useState(false);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const gen = await generateWalletKey();
      setSeedHex(gen.seedHex);
      setMeta(gen.meta);
      setStep("reveal");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  const normalized = retyped.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  const retypedComplete = normalized.length === 64;

  function handleVerify() {
    if (!seedHex || !retypedComplete) return;
    if (normalized !== seedHex.toLowerCase()) {
      setError(
        "The key doesn't match. Check your saved copy and retype it exactly.",
      );
      return;
    }
    setError(null);
    setStep("pass");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!seedHex || !meta) return;
    setBusy(true);
    setError(null);
    try {
      await saveWalletKey(seedHex, pass1, meta);
      await unlock(pass1); // active for this session right away
      cleanup(); // seed no longer needed in component memory
      setStep("done");
      onComplete(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  }

  function cleanup() {
    setSeedHex(null);
    setRetyped("");
    setPass1("");
    setPass2("");
  }

  return (
    <div className="flex w-full min-w-0 justify-center">
      <Card className="w-full min-w-0 max-w-md overflow-hidden p-6 sm:p-7">
        <div className="space-y-5">
          {/* ── STEP: intro ─────────────────────────────────────────── */}
          {step === "intro" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-canton-muted bg-canton-subtle">
                  <KeyRound className="h-5 w-5 text-canton" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Wallet
                  </p>
                  <h2 className="text-lg font-semibold leading-tight text-[var(--foreground)]">
                    Create Your Wallet Key
                  </h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                Your private key is generated and stored{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  only in this browser
                </span>
                . CanQuest never stores it — and cannot recover it if lost.
              </p>
              <div className="flex items-start gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                <p className="text-sm leading-relaxed text-[var(--foreground)]">
                  You will receive a <strong>64-character backup key</strong>.
                  Save it somewhere safe offline. A lost key means lost funds —
                  permanently. There is no reset and no support team that can
                  restore it.
                </p>
              </div>
              {error ? (
                <p role="alert" className="text-sm font-medium text-orange-600">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGenerate()}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : <KeyRound className="h-4 w-4" />}
                Create My Key
              </button>
              {onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="mx-auto flex items-center gap-1 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              ) : null}
            </div>
          ) : null}

          {/* ── STEP: reveal (once) ──────────────────────────────────── */}
          {step === "reveal" && seedHex ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Wallet
                </p>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  Your Backup Key
                </h2>
                <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Shown <strong>only once</strong>. Copy and store it now —
                  after continuing, it can only be viewed again in Settings
                  with your passphrase.
                </p>
              </div>
              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
                <CopyField label="Private Key (Raw Hex — 64 characters)" value={seedHex} />
              </div>
              <button
                type="button"
                onClick={() => setStep("verify")}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                <CheckCircle2 className="h-4 w-4" />
                I've Saved It
              </button>
              <button
                type="button"
                onClick={() => {
                  cleanup();
                  setStep("intro");
                }}
                className="mx-auto flex items-center gap-1 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Cancel &amp; Regenerate
              </button>
            </div>
          ) : null}

          {/* ── STEP: verify (retype full key) ───────────────────────── */}
          {step === "verify" && seedHex ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Wallet
                </p>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  Verify Your Backup
                </h2>
                <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Paste or retype the <strong>full 64-character key</strong>{" "}
                  from your saved copy to confirm your backup is complete and
                  correct.
                </p>
              </div>
              <textarea
                value={retyped}
                onChange={(e) => {
                  setRetyped(e.target.value);
                  setError(null);
                }}
                placeholder="Your 64-character backup key…"
                rows={3}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={cn(inputClass, "resize-none font-mono text-sm leading-relaxed")}
              />
              <p
                className={cn(
                  "text-xs font-medium",
                  retypedComplete
                    ? "text-emerald-600"
                    : "text-[var(--muted-foreground)]",
                )}
              >
                {normalized.length}/64 characters
              </p>
              {error ? (
                <p role="alert" className="text-sm font-medium text-orange-600">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={!retypedComplete}
                onClick={handleVerify}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                <CheckCircle2 className="h-4 w-4" />
                Verify
              </button>
              <button
                type="button"
                onClick={() => {
                  setRetyped("");
                  setError(null);
                  setStep("reveal");
                }}
                className="mx-auto flex items-center gap-1 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Show My Key Again
              </button>
            </div>
          ) : null}

          {/* ── STEP: passphrase ─────────────────────────────────────── */}
          {step === "pass" ? (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-canton-muted bg-canton-subtle">
                  <Lock className="h-5 w-5 text-canton" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Wallet
                  </p>
                  <h2 className="text-lg font-semibold leading-tight text-[var(--foreground)]">
                    Wallet Passphrase
                  </h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                This passphrase encrypts your key in this browser and is
                requested every time you sign a transaction. CanQuest never
                stores it.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="ceremony-pass-1"
                    className="text-sm font-medium text-[var(--muted-foreground)]"
                  >
                    Passphrase (min. 8 characters)
                  </label>
                  <input
                    id="ceremony-pass-1"
                    type={showPass ? "text" : "password"}
                    value={pass1}
                    onChange={(e) => setPass1(e.target.value)}
                    minLength={8}
                    required
                    autoFocus
                    className={cn(inputClass, "font-mono")}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="ceremony-pass-2"
                    className="text-sm font-medium text-[var(--muted-foreground)]"
                  >
                    Repeat passphrase
                  </label>
                  <input
                    id="ceremony-pass-2"
                    type={showPass ? "text" : "password"}
                    value={pass2}
                    onChange={(e) => setPass2(e.target.value)}
                    minLength={8}
                    required
                    className={cn(inputClass, "font-mono")}
                  />
                  {pass1 !== pass2 && pass2.length > 0 ? (
                    <p className="text-xs font-medium text-orange-600">
                      Passphrases don&apos;t match yet.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="text-xs font-medium text-canton hover:underline"
                >
                  {showPass ? "Hide passphrases" : "Show passphrases"}
                </button>
              </div>
              {error ? (
                <p role="alert" className="text-sm font-medium text-orange-600">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy || pass1.length < 8 || pass1 !== pass2}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : <ShieldCheck className="h-4 w-4" />}
                Save &amp; Finish
              </button>
            </form>
          ) : null}

          {/* ── STEP: done ───────────────────────────────────────────── */}
          {step === "done" && meta ? (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  Wallet Key Active
                </h2>
                <p className="break-all font-mono text-xs text-[var(--muted-foreground)]">
                  {meta.partyIdPreview}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
