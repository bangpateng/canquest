"use client";

import { useState } from "react";
import { Fingerprint, Plus, Trash2, RefreshCw, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { usePasskey } from "@/lib/hooks/use-passkey";
import { PasskeyEnrollModal } from "@/components/app/wallet/passkey-enroll-modal";
import { PasskeyModal } from "@/components/app/wallet/passkey-modal";

/**
 * Settings panel untuk passkey (menggantikan SettingsWalletPasswordPanel).
 *
 * UI:
 *   - Status: Enabled / Not set
 *   - List device terdaftar + Remove per device
 *   - Add device (enroll passkey baru)
 *   - Regenerate backup codes (gated by passkey verify)
 *
 * Backup codes hanya ditampilkan saat generate (first enroll atau regenerate) —
 * tidak bisa re-show (safety).
 */
export function SettingsPasskeyPanel() {
  const { hasPasskey, credentials, enrollPasskey, removeCredential, refresh } =
    usePasskey();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyAction, setVerifyAction] = useState<
    "regenerate" | null
  >(null);

  const handleAddDevice = () => {
    setEnrollOpen(true);
  };

  const handleRegenerateClick = () => {
    setVerifyAction("regenerate");
    setVerifyOpen(true);
  };

  const handleVerified = async (txToken: string) => {
    setVerifyOpen(false);
    if (verifyAction === "regenerate") {
      setBusy(true);
      setMessage("");
      try {
        const res = await fetch("/api/party/passkey/backup/regenerate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txVerification: txToken }),
        });
        const data = (await res.json()) as {
          backupCodes?: string[];
          message?: string;
        };
        if (!res.ok) {
          setMessage(data.message ?? "Regenerate failed.");
        } else {
          // Copy ke clipboard + tampilkan.
          const codes = data.backupCodes ?? [];
          setMessage(
            `New backup codes generated (${codes.length}). Copied to clipboard — save them now.`,
          );
          void navigator.clipboard.writeText(codes.join("\n"));
        }
      } catch {
        setMessage("Network error. Try again.");
      } finally {
        setBusy(false);
        setVerifyAction(null);
      }
    }
  };

  const handleRemove = async (credentialId: string) => {
    if (!confirm("Remove this device? You will need passkey from another device to transact.")) {
      return;
    }
    setBusy(true);
    try {
      await removeCredential(credentialId);
      setMessage("Device removed.");
    } catch (err) {
      setMessage((err as Error).message ?? "Remove failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="passkey"
      className="rounded-2xl border border-white/5 bg-[#0a0c14]/80 p-6 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5 text-emerald-400" aria-hidden />
          <h2 className="text-base font-bold text-slate-100">Passkey</h2>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            hasPasskey
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-slate-500/15 text-slate-400",
          )}
        >
          {hasPasskey ? "Enabled" : "Not set"}
        </span>
      </div>

      <p className="text-sm text-slate-400">
        Passkey (Face ID / Touch ID / PIN) melindungi setiap transaksi. Wajib
        untuk kirim, swap, lock. Tidak bisa ditebak, tidak bisa dicuri phishing.
      </p>

      {/* Device list */}
      {credentials.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Devices ({credentials.length})
          </h3>
          {credentials.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">
                  {c.deviceLabel || `Device ${c.id.slice(0, 8)}…`}
                </p>
                <p className="text-xs text-slate-500">
                  Added {new Date(c.createdAt).toLocaleDateString()}
                  {c.lastUsedAt &&
                    ` · Last used ${new Date(c.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(c.id)}
                disabled={busy || credentials.length === 1}
                title={
                  credentials.length === 1
                    ? "Add another device first before removing the last one"
                    : "Remove device"
                }
                className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleAddDevice}
          disabled={busy}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-2")}
        >
          <Plus className="h-4 w-4" /> Add device
        </button>
        {hasPasskey && (
          <button
            type="button"
            onClick={handleRegenerateClick}
            disabled={busy}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-2")}
          >
            <RefreshCw className="h-4 w-4" /> Regenerate backup codes
          </button>
        )}
      </div>

      {message && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border p-3 text-sm",
            message.includes("error") || message.includes("failed")
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
          )}
        >
          {message.includes("error") || message.includes("failed") ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="font-medium">{message}</span>
        </div>
      )}

      {/* Modals */}
      <PasskeyEnrollModal
        open={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          void refresh();
        }}
        onEnrolled={() => {
          setEnrollOpen(false);
          void refresh();
          setMessage("Passkey added.");
        }}
      />
      <PasskeyModal
        open={verifyOpen}
        actionLabel="Regenerate Backup Codes"
        busy={busy}
        onClose={() => {
          setVerifyOpen(false);
          setVerifyAction(null);
        }}
        onVerified={(tok) => void handleVerified(tok)}
      />
    </section>
  );
}
