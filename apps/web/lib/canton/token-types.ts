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
 * Shape response GET /api/party/pools.
 * `tokens` = daftar instrument yang tersedia (dari AMM pools).
 */
export interface PoolsResponse {
  tokens: WalletToken[];
}

/**
 * Shape response GET /api/party/balances.
 * `tokens` = map balance keyed by instrumentId (lowercase) → decimal string.
 *
 * DB-DRIVEN: backend aggregate CantexTokenBalance per instrumentId, key cuma
 * instrumentId (BUKAN composite id::admin). Cantex tidak ikut campur di jalur
 * saldo — sesuai prinsip "Cantex = swap-only". CC baca CcBalance, token baca
 * CantexTokenBalance, keduanya per userId dari DB.
 */
export interface BalancesResponse {
  cc: number;
  tokens: Record<string, string>;
}

/**
 * Build key map balance untuk lookup balance suatu token.
 * Konsisten dengan party.controller GET /balances (key = instrumentId lowercase).
 */
export function tokenBalanceKey(
  t: Pick<WalletToken, 'instrumentId'>,
): string {
  return t.instrumentId.toLowerCase();
}
