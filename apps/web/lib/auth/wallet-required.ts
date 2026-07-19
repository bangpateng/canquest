import { formatApiError } from "@/lib/api/format-api-error";

/**
 * Pesan backend saat user mencoba akses endpoint yang butuh wallet.
 * MUST match WALLET_REQUIRED_MESSAGE di apps/api/src/common/wallet-policy.ts.
 */
export const WALLET_REQUIRED_MESSAGE =
  "Please create your Canton wallet first to access Earn.";

/**
 * True bila error dari backend adalah 403 wallet-required (user klik tombol
 * tanpa wallet — bypass UX gating). Frontend bisa pakai ini untuk menampilkan
 * modal 'Create wallet' alih-alih toast error generik.
 *
 * Match longgar (includes) supaya robust terhadap variasi kalimat di backend
 * (mis. "...access Send." / "...access Swap." / dst).
 */
export function isWalletRequiredError(data: unknown): boolean {
  const message = formatApiError(data, "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("create your canton wallet") ||
    message.includes("create your wallet first") ||
    message.includes("wallet first")
  );
}

/**
 * Helper untuk komponen UI: return { isWalletRequired, message }.
 * Komponen bisa conditional render modal `WalletCreatePromptModal` kalau
 * `isWalletRequired=true`, atau tampilkan message biasa kalau false.
 */
export function analyzeWalletError(data: unknown): {
  isWalletRequired: boolean;
  message: string;
} {
  const message = formatApiError(data);
  return {
    isWalletRequired: isWalletRequiredError(data),
    message,
  };
}
