/**
 * Shared token types untuk wallet (send, swap, list).
 *
 * Sebelumnya `interface SwapToken { instrumentId; instrumentAdmin; isCC? }`
 * diduplikasi lokal di swap-modal.tsx dan token-list.tsx. Sekarang fitur send-token
 * juga memakainya → diekstrak ke sini supaya konsisten.
 */

/** Satu token di wallet (CC atau token non-CC seperti USDCx). */
export interface WalletToken {
  /** Cantex instrument id, mis. "Amulet" (CC) / "USDCX". */
  instrumentId: string;
  /** Cantex instrument admin party, mis. "DSO::1220...". */
  instrumentAdmin: string;
  /** True kalau ini CC/Amulet (leg khusus, pakai /send-cc, bukan /send-token). */
  isCC?: boolean;
}

/**
 * Shape response GET /api/party/swap/pools.
 * `tokens` = daftar instrument yang tersedia (dari AMM pools).
 */
export interface PoolsResponse {
  tokens: WalletToken[];
}

/**
 * Shape response GET /api/party/swap/balances.
 * `tokens` = map balance keyed by "<instrumentId>::<instrumentAdmin>" → decimal string.
 * Konvensi key composite `id::admin` dipakai konsisten di backend + frontend.
 */
export interface BalancesResponse {
  cc: number;
  tokens: Record<string, string>;
}

/**
 * Build key map balance untuk lookup balance suatu token.
 * Konsisten dengan party.controller GET swap/balances (composite `id::admin`).
 */
export function tokenBalanceKey(t: Pick<WalletToken, 'instrumentId' | 'instrumentAdmin'>): string {
  return `${t.instrumentId}::${t.instrumentAdmin}`;
}
