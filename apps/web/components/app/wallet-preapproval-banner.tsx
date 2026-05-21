"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatApiError } from "@/lib/format-api-error";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type PreapprovalStatus = {
  hasWallet?: boolean;
  isPlaceholder?: boolean;
  preapproval?: {
    active?: boolean;
    message?: string;
    walletUiUrl?: string | null;
  };
};

interface WalletPreapprovalBannerProps {
  onActivated?: () => void;
}

/**
 * CIP-56 (Opsi B): menampilkan status TransferPreapproval dan tombol aktivasi.
 */
export function WalletPreapprovalBanner({ onActivated }: WalletPreapprovalBannerProps) {
  const [status, setStatus] = useState<PreapprovalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/party/preapproval-status", { credentials: "include" });
      if (res.ok) {
        setStatus((await res.json()) as PreapprovalStatus);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/party/ensure-preapproval", {
        method: "POST",
        credentials: "include",
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }
      await load();
      onActivated?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-xs text-[var(--muted-foreground)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Memeriksa preapproval CIP-56…
      </div>
    );
  }

  if (!status?.hasWallet) return null;

  if (status.isPlaceholder) {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium">Wallet belum terhubung ke Splice</p>
          <p className="mt-1 opacity-90">
            Buat ulang wallet saat tunnel aktif agar Opsi B (preapproval) bisa dipakai.
          </p>
        </div>
      </div>
    );
  }

  const active = status.preapproval?.active === true;

  if (active) {
    return (
      <div className="flex gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <div className="text-xs text-green-800 dark:text-green-200">
          <p className="font-medium">CIP-56 aktif — terima CC langsung</p>
          <p className="mt-1 opacity-90">
            TransferPreapproval aktif. Kirim dari wallet validator ke Party ID ini tanpa Accept
            manual.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-canton/30 bg-canton/10 px-4 py-4">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-canton" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-[var(--foreground)]">
            Aktifkan preapproval (Opsi B / CIP-56)
          </p>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Wajib agar CC dari wallet validator masuk langsung. Tanpa ini, transfer manual
            menggantung sampai di-accept di Splice Wallet.
          </p>
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void activate()}
            className={cn(buttonVariants({ size: "sm" }), "gap-2")}
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Mengaktifkan…
              </>
            ) : (
              "Aktifkan preapproval"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
