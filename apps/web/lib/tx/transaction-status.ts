import { create } from "zustand";

/**
 * Unified on-chain transaction status modal — presentation layer only.
 *
 * Standar flow web3 (satu modal pada satu waktu — tidak ada tumpang-tindih):
 *   Input → Review (TxReviewModal) → Sign (stage 'sign' + passphrase prompt
 *   bila dompet terkunci) → Broadcast → Success / Failed.
 *
 * It does NOT execute any on-chain call: callers drive the stages around
 * their own existing async fetch (start → broadcast while awaiting → succeed
 * on resolve / fail on rejection). All real data (hash, round, meta) is
 * supplied by the caller from the API response; nothing is fabricated.
 */

export type TxStage = "sign" | "broadcast" | "confirmed" | "failed";

export interface TxMetaRow {
  label: string;
  value: string;
  /** Render the value in a monospace face (addresses, hashes, ids). */
  mono?: boolean;
}

export interface TxStatusConfig {
  /** Tailwind classes for the status icon box background. */
  accentBg?: string;
  /** Tailwind classes for the status icon glyph color. */
  accentText?: string;
  /** Amount headline, e.g. "5 CC" or "10 CC → 9.94 USDCx". */
  amountText: string;
  /** Nominal token utk estimasi USD live di bawah amount (confirmed stage). */
  usdAmount?: { amount: number; token: string } | null;
  /** Secondary line under the amount on the sign stage (e.g. recipient). */
  subText?: string;
  /** Title shown on the confirmed stage, e.g. "Transfer sent". */
  title: string;
  /** Catatan tambahan di stage broadcast (mis. "OneSwap matching — up to a minute"). */
  broadcastNote?: string;
  /** Subtitle shown under the title on confirmed. */
  subtitle?: string;
  /** Title override on the failed stage (default "Transaction failed"). */
  failedTitle?: string;
  /** Detail rows shown on the confirmed stage (Type / Rate / …). */
  meta?: TxMetaRow[];
  /** Real on-chain transaction hash (display-ready), if the API returned one. */
  txHash?: string | null;
  /** Optional explorer URL backing the hash link. */
  explorerUrl?: string | null;
  /** Optional Canton round number — only rendered when actually known. */
  round?: number | null;
  /** Fired once when the confirmed stage is entered. */
  onConfirmed?: () => void;
  /** Fired when the user closes via Done after success. */
  onDone?: () => void;
  /** Fired when the user cancels (pre-confirmation or after failure). */
  onCancel?: () => void;
}

interface TxStatusState {
  open: boolean;
  stage: TxStage;
  config: TxStatusConfig | null;
  /** Error message shown on the failed stage. */
  errorMessage: string | null;
  /** Retried by the user from the failed stage, if provided. */
  retry: (() => void | Promise<void>) | null;
  /** Open at the sign (authorize) stage. */
  start: (config: TxStatusConfig) => void;
  /** Open DIRECTLY at broadcast stage — signing already completed via
   *  the passphrase modal (which is the real sign UX). The tx modal
   *  shouldn't compete with / appear behind the passphrase prompt. */
  startBroadcast: (config: TxStatusConfig) => void;
  /** Advance to the broadcast (network) stage. */
  broadcast: () => void;
  /** Advance to confirmed, merging any patch (hash / meta / round / title). */
  succeed: (patch?: Partial<TxStatusConfig>) => void;
  /** Advance to failed with the error message (no auto-close). */
  fail: (message: string, patch?: Partial<TxStatusConfig>) => void;
  /** Close from any stage; fires onCancel when not yet confirmed. */
  dismiss: () => void;
  /** Close after success; fires onDone. */
  done: () => void;
  /** Re-run the transaction from the failed stage. */
  tryAgain: () => void;
}

export const useTransactionStatus = create<TxStatusState>((set, get) => ({
  open: false,
  stage: "sign",
  config: null,
  errorMessage: null,
  retry: null,
  start: (config) => set({ open: true, stage: "sign", config, errorMessage: null, retry: null }),
  startBroadcast: (config) =>
    set({ open: true, stage: "broadcast", config, errorMessage: null, retry: null }),
  broadcast: () => set({ stage: "broadcast" }),
  succeed: (patch) => {
    const cur = get().config;
    if (!cur) return;
    const next: TxStatusConfig = { ...cur, ...patch };
    set({ stage: "confirmed", config: next });
    next.onConfirmed?.();
    // Auto-close setelah 2.5 detik supaya modal tidak menumpuk dgn modal lain
    setTimeout(() => {
      if (get().stage === "confirmed" && get().open) {
        set({ open: false });
        next.onDone?.();
      }
    }, 2500);
  },
  fail: (message, patch) => {
    const cur = get().config;
    if (!cur) return;
    set({ stage: "failed", config: { ...cur, ...patch }, errorMessage: message });
  },
  dismiss: () => {
    const { stage, config } = get();
    set({ open: false });
    if (stage !== "confirmed") config?.onCancel?.();
  },
  done: () => {
    const { config } = get();
    set({ open: false });
    config?.onDone?.();
  },
  tryAgain: () => {
    const { retry } = get();
    set({ open: false });
    retry?.();
  },
}));
