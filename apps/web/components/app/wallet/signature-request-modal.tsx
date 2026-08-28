"use client";

import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils/utils";

/**
 * SignatureRequestModal — konfirmasi tanda tangan ala wallet (mockup
 * `Signature Request`). Ringkas: amount di tengah + baris kecil kiri-kanan
 * (mis. router aktif). Tanpa input passphrase — dompet auto-unlock via
 * device key (sign-relay); passphrase hanya untuk Settings → Wallet Keys.
 *
 * Layering: z-[85] — di atas review (z-60), DI BAWAH TransactionStatusModal
 * (z-90, backdrop opaque) supaya status broadcast/success mengambil alih
 * begitu tanda tangan selesai.
 */
export interface SignatureRequestRow {
  label: string;
  value: string;
}

export interface SignatureRequestModalProps {
  open: boolean;
  /** Headline amount di tengah, mis. "5 CC" atau "1 CC → 0.0565 USDCx". */
  amountText: string;
  /** Baris kecil di bawah amount (mis. penerima / "via OneSwap"). */
  subText?: string;
  /** Baris detail kecil kiri-kanan (mis. Router). */
  rows?: SignatureRequestRow[];
  /** true = tombol Sign disabled + spinner ("Signing…"). */
  busy?: boolean;
  onSign: () => void;
  onReject: () => void;
}

export function SignatureRequestModal({
  open,
  amountText,
  subText,
  rows,
  busy,
  onSign,
  onReject,
}: SignatureRequestModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Signature request"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative z-10 my-auto w-full max-w-[380px] rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)]">
        {/* Wallet header — identitas peminta tanda tangan */}
        <div className="mb-5 flex items-center gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canton-subtle text-sm font-bold text-canton ring-1 ring-canton-muted">
            CQ
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-[var(--foreground)]">
              Signature Request
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">canquest.cc</p>
          </div>
        </div>

        {/* Amount headline */}
        <div className="mb-4 text-center">
          <p className="text-3xl font-bold tabular-nums text-[var(--foreground)]">
            {amountText}
          </p>
          {subText ? (
            <p className="mt-1 text-sm font-medium text-[var(--muted-foreground)]">
              {subText}
            </p>
          ) : null}
        </div>

        {/* Baris kecil kiri-kanan (mis. router aktif) */}
        {rows && rows.length > 0 ? (
          <div className="mb-4 space-y-1.5 rounded-xl bg-[var(--muted)]/60 px-4 py-3">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium text-[var(--muted-foreground)]">
                  {row.label}
                </span>
                <span className="font-semibold text-[var(--foreground)]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <p className="mb-5 text-xs leading-relaxed text-[var(--muted-foreground)]">
          Your key signs this transaction in your browser — it never leaves
          your device.
        </p>

        {/* Actions — style tombol dapp (secondary + primary) */}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "flex-1 px-4 py-3.5 text-sm",
            )}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSign}
            className={cn(buttonVariants(), "flex-1 gap-2 px-4 py-3.5 text-sm")}
          >
            {busy ? (
              <>
                <LoadingSpinner size="sm" />
                Signing…
              </>
            ) : (
              "Sign & Send"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
