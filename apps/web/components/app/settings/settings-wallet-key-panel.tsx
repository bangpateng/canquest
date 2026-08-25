"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui/ui-tokens";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CopyField } from "@/components/app/wallet/copy-field";
import { KeyCeremony } from "@/components/app/wallet/key-ceremony";
import { useMe } from "@/lib/hooks/use-me";
import { signHashWithUnlock } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";
import {
  deleteWalletKey,
  exportSeedHex,
  getWalletKeyMeta,
  hasWalletKey,
  importWalletKey,
  lock,
  signPreparedHash,
  unlock,
  type WalletKeyMeta,
} from "@/lib/wallet/key-manager";

/**
 * Settings → Wallet Key (non-custodial, M1 + M4 upgrade).
 *
 * Panel for the wallet key that lives only in the user's browser:
 *   - status + party ID preview
 *   - view raw-hex backup key (passphrase unlock, auto-lock on close)
 *   - restore from raw-hex backup (new device / browser)
 *   - remove wallet key from this browser (danger zone)
 *   - M4: custodial users get an "Upgrade to Non-Custodial" card that runs
 *     the key ceremony + registers an external party (old wallet must be empty).
 *
 * New keys for brand-new users are created during wallet onboarding (M2) —
 * not here. This panel never sends the private key to any server.
 */

type Phase = "loading" | "none" | "ready" | "upgrading" | "registering";
type RevealState = "hidden" | "form" | "shown";
type DeleteState = "idle" | "confirm" | "done";

export function SettingsWalletKeyPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [meta, setMeta] = useState<WalletKeyMeta | null>(null);

  // M4: detect custodial users → offer upgrade to non-custodial.
  const { me, refetch: refetchMe } = useMe();
  const isCustodial = me?.walletKind === "custodial" && !!me.cantonPartyId;
  const [resumeMeta, setResumeMeta] = useState<WalletKeyMeta | null>(null);
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();

  // Reveal (view backup key)
  const [reveal, setReveal] = useState<RevealState>("hidden");
  const [passphrase, setPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import (restore)
  const [importOpen, setImportOpen] = useState(false);
  const [importHex, setImportHex] = useState("");
  const [importPass, setImportPass] = useState("");
  const [importPass2, setImportPass2] = useState("");

  // Delete (danger zone)
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");

  const refresh = useCallback(async () => {
    try {
      const exists = await hasWalletKey();
      setMeta(exists ? await getWalletKeyMeta() : null);
      setPhase(exists ? "ready" : "none");
    } catch {
      setPhase("none");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => lock(); // auto-lock when the panel closes/unmounts
  }, [refresh]);

  function resetReveal() {
    setReveal("hidden");
    setPassphrase("");
    setSeedHex(null);
    lock();
  }

  async function handleUnlock() {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(passphrase);
      setSeedHex(exportSeedHex());
      setReveal("shown");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (importPass !== importPass2) {
      setError("Passphrases don't match");
      return;
    }
    setBusy(true);
    try {
      const imported = await importWalletKey(importHex, importPass);
      setMeta(imported);
      setPhase("ready");
      setImportOpen(false);
      setImportHex("");
      setImportPass("");
      setImportPass2("");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteWalletKey();
      setMeta(null);
      setPhase("none");
      setDeleteState("done");
      resetReveal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove wallet key");
    } finally {
      setBusy(false);
    }
  }

  // ── M4: upgrade helpers ────────────────────────────────────────────────

  async function startUpgrade() {
    // RESUME: kalau browser ini sudah menyimpan kunci ceremony (upgrade yang
    // terputus — mis. gagal registrasi karena flag), pakai ulang kunci itu
    // dan langsung ke registrasi. Tanpa ini user terjebak ("key exists").
    if (await hasWalletKey()) {
      const existing = await getWalletKeyMeta();
      if (existing?.publicKeyHex && existing.hint) {
        setError(null);
        setResumeMeta(existing);
        setPhase("registering");
        void registerUpgradeWallet(existing);
        return;
      }
      setError(
        "This browser already stores a wallet key that cannot be reused. Clear this site's browser data (or use another browser) before upgrading.",
      );
      return;
    }
    setError(null);
    setResumeMeta(null);
    setPhase("upgrading");
  }

  /** M4: register external wallet in upgrade mode (old wallet must be empty). */
  async function registerUpgradeWallet(upgradeMeta: WalletKeyMeta) {
    setBusy(true);
    setError(null);
    try {
      const prep = await fetch("/api/party/wallet-external/prepare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKeyHex: upgradeMeta.publicKeyHex,
          partyHint: upgradeMeta.hint,
          upgrade: true,
        }),
      });
      const prepRaw = (await prep.json().catch(() => null)) as {
        multiHash?: string;
        message?: string;
      } | null;
      if (!prep.ok || !prepRaw?.multiHash) {
        setError(prepRaw?.message ?? "Failed to prepare the upgrade.");
        setPhase("none");
        return;
      }
      // Sign dengan auto-unlock (resume sesi baru = dompet terkunci).
      const signature = await signHashWithUnlock(
        prepRaw.multiHash,
        "Complete wallet upgrade",
        { onWalletLocked: () => promptPassphrase("Complete wallet upgrade") },
      );
      const comp = await fetch("/api/party/wallet-external/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, upgrade: true }),
      });
      const compRaw = (await comp.json().catch(() => null)) as {
        cantonPartyId?: string;
        message?: string;
      } | null;
      if (!comp.ok) {
        setError(compRaw?.message ?? "Upgrade failed.");
        setPhase("none");
        return;
      }
      setMeta(upgradeMeta);
      setPhase("ready");
      void refetchMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upgrade failed.");
      setPhase("none");
    } finally {
      setBusy(false);
    }
  }

  const hexValid = /^[0-9a-fA-F]{64}$/.test(importHex.trim());

  return (
    <Card id="wallet-key" className="scroll-mt-8 overflow-hidden">
      <div>
        {/* Section header — click to collapse/expand */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between p-6 transition-colors hover:bg-[var(--primary)]/[0.04] sm:p-7"
        >
          <div className="text-left">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Wallet
            </p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
              <KeyRound className="h-5 w-5 text-canton" />
              Wallet Key (Non-Custodial)
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Your private key is stored encrypted in this browser — it is
              never sent to a server.
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-[var(--muted-foreground)] transition-transform",
              collapsed && "-rotate-90",
            )}
          />
        </button>

        {!collapsed && (
          <div className="space-y-6 border-t border-[var(--border)] p-6 sm:p-7">
            {phase === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <LoadingSpinner size="sm" />
                Checking for a wallet key in this browser…
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-600"
              >
                {error}
              </p>
            ) : null}

            {/* ── M4: custodial user → upgrade offer ─────────────────── */}
            {isCustodial && phase === "none" ? (
              <div className="space-y-4 rounded-2xl border border-canton/30 bg-canton-subtle p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-canton" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-[var(--foreground)]">
                      Upgrade to a Non-Custodial Wallet
                    </p>
                    <p className="mt-1 leading-relaxed text-[var(--muted-foreground)]">
                      Your current wallet is held by the server (custodial).
                      Upgrade to hold your own key — the key is created and
                      stored <strong>only in this browser</strong>, and every
                      transaction requires your signature.
                    </p>
                    <p className="mt-2 rounded-xl bg-orange-500/10 px-3 py-2 text-xs leading-relaxed text-orange-600">
                      Requirement: your old wallet balance must be empty. After
                      upgrading: a lost key means permanently lost funds — make
                      sure you save the raw hex backup during the process.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void startUpgrade()}
                  className={cn(buttonVariants({ size: "sm" }), "gap-2")}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Upgrade Now
                </button>
              </div>
            ) : null}

            {/* ── M4: key ceremony for upgrade ────────────────────────── */}
            {phase === "upgrading" ? (
              <KeyCeremony
                onComplete={(m) => {
                  void registerUpgradeWallet(m);
                }}
                onCancel={() => setPhase("none")}
              />
            ) : null}

            {/* ── M4: resume upgrade (registrasi dengan kunci yang sudah ada) ── */}
            {phase === "registering" ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-canton/30 bg-canton-subtle p-6 text-sm font-medium text-[var(--foreground)]">
                <LoadingSpinner size="sm" />
                Completing your upgrade — registering your wallet key…
              </div>
            ) : null}
            {passphraseModal}

            {/* ── No wallet key yet ───────────────────────────────────── */}
            {phase === "none" && !isCustodial ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-4">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
                  <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                    No non-custodial wallet key in this browser yet. Keys are
                    created during new wallet setup, or restore from a backup
                    if you already have a wallet on another device.
                  </p>
                </div>

                {!importOpen ? (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
                    onClick={() => {
                      setImportOpen(true);
                      setError(null);
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                    Restore from Backup Key
                  </button>
                ) : (
                  <ImportForm
                    importHex={importHex}
                    setImportHex={setImportHex}
                    importPass={importPass}
                    setImportPass={setImportPass}
                    importPass2={importPass2}
                    setImportPass2={setImportPass2}
                    hexValid={hexValid}
                    busy={busy}
                    onSubmit={handleImport}
                    onCancel={() => {
                      setImportOpen(false);
                      setError(null);
                    }}
                  />
                )}
              </div>
            ) : null}

            {/* ── Wallet key present ──────────────────────────────────── */}
            {phase === "ready" && meta ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl border border-canton/30 bg-canton-subtle p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-canton" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-[var(--foreground)]">
                      Non-custodial wallet active in this browser
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-[var(--muted-foreground)]">
                      {meta.partyIdPreview}
                    </p>
                  </div>
                </div>

                {/* View backup key */}
                {reveal === "hidden" ? (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
                    onClick={() => {
                      setReveal("form");
                      setError(null);
                    }}
                  >
                    <Eye className="h-4 w-4" />
                    View Backup Key (Raw Hex)
                  </button>
                ) : null}

                {reveal === "form" ? (
                  <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Enter your wallet passphrase to reveal the key.
                    </p>
                    <div className="relative">
                      <input
                        type={showPass ? "text" : "password"}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="Wallet passphrase"
                        autoFocus
                        className={cn(inputClass, "pr-11 font-mono")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleUnlock();
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                        aria-label={showPass ? "Hide passphrase" : "Show passphrase"}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || !passphrase}
                        onClick={() => void handleUnlock()}
                        className={cn(buttonVariants({ size: "sm" }), "gap-2")}
                      >
                        {busy ? <LoadingSpinner size="sm" /> : <Lock className="h-4 w-4" />}
                        Unlock
                      </button>
                      <button
                        type="button"
                        onClick={resetReveal}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {reveal === "shown" && seedHex ? (
                  <div className="space-y-4 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                      <p className="text-sm leading-relaxed text-[var(--foreground)]">
                        <span className="font-semibold text-orange-600">
                          Never share this with anyone
                        </span>{" "}
                        — anyone holding these 64 characters controls your
                        wallet. Keep it somewhere safe offline.
                      </p>
                    </div>
                    <CopyField label="Private Key (Raw Hex)" value={seedHex} />
                    <button
                      type="button"
                      onClick={resetReveal}
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-2")}
                    >
                      <EyeOff className="h-4 w-4" />
                      Hide &amp; Lock
                    </button>
                  </div>
                ) : null}

                {/* Danger zone */}
                <div className="space-y-3 rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    Danger Zone
                  </p>
                  {deleteState !== "confirm" ? (
                    <>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Remove the wallet key from{" "}
                        <em>this browser</em>. The wallet still exists on
                        chain — it can be restored with the raw hex on any
                        device. Without a backup, funds can no longer be
                        accessed.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDeleteState("confirm")}
                        className={cn(
                          buttonVariants({ variant: "secondary", size: "sm" }),
                          "gap-2 border-red-500/40 text-red-600 hover:bg-red-500/10",
                        )}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove Wallet from This Browser
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[var(--foreground)]">
                        Are you sure? The key will be lost from this browser.
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete()}
                        className={cn(buttonVariants({ size: "sm" }), "gap-2 bg-red-600 hover:bg-red-700")}
                      >
                        {busy ? <LoadingSpinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                        Yes, Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteState("idle")}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Restore form ──────────────────────────────────────────────────────────

function ImportForm(props: {
  importHex: string;
  setImportHex: (v: string) => void;
  importPass: string;
  setImportPass: (v: string) => void;
  importPass2: string;
  setImportPass2: (v: string) => void;
  hexValid: boolean;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const {
    importHex,
    setImportHex,
    importPass,
    setImportPass,
    importPass2,
    setImportPass2,
    hexValid,
    busy,
    onSubmit,
    onCancel,
  } = props;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-4"
    >
      <div className="space-y-2">
        <label
          htmlFor="import-key-hex"
          className="text-sm font-medium text-[var(--muted-foreground)]"
        >
          Backup key (64 hex characters)
        </label>
        <input
          id="import-key-hex"
          value={importHex}
          onChange={(e) => setImportHex(e.target.value.replace(/[^0-9a-fA-F]/g, ""))}
          placeholder="db13003d6522b1e2eb8e8a2e55fc5d60…"
          maxLength={64}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={busy}
          className={cn(inputClass, "font-mono")}
        />
        {importHex.length > 0 && !hexValid ? (
          <p className="text-xs font-medium text-orange-600">
            Must be exactly 64 hex characters ({importHex.length}/64).
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="import-pass-1"
            className="text-sm font-medium text-[var(--muted-foreground)]"
          >
            New passphrase (min. 8 characters)
          </label>
          <input
            id="import-pass-1"
            type="password"
            value={importPass}
            onChange={(e) => setImportPass(e.target.value)}
            minLength={8}
            required
            disabled={busy}
            className={cn(inputClass, "font-mono")}
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor="import-pass-2"
            className="text-sm font-medium text-[var(--muted-foreground)]"
          >
            Repeat passphrase
          </label>
          <input
            id="import-pass-2"
            type="password"
            value={importPass2}
            onChange={(e) => setImportPass2(e.target.value)}
            minLength={8}
            required
            disabled={busy}
            className={cn(inputClass, "font-mono")}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || !hexValid || importPass.length < 8}
          className={cn(buttonVariants({ size: "sm" }), "gap-2")}
        >
          {busy ? <LoadingSpinner size="sm" /> : <KeyRound className="h-4 w-4" />}
          Restore Wallet
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
