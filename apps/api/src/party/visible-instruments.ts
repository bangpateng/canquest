/**
 * Whitelist token yang ditampilkan & dipakai di dapp. Hanya CC (Amulet) +
 * USDCx + CBTC. Token lain dari Cantex pools (HANDL, MOD, HECTO, FRXUSD.B,
 * cETH, EDELx, USDC.B) disembunyikan — tidak di-query, tidak ditampilkan.
 * Dipakai di /balances, /pools, /prices supaya konsisten.
 *
 * Shared util — dipakai PartyController + CantonPriceService (agar key price
 * map konsisten dengan daftar token di /pools).
 */
export const VISIBLE_INSTRUMENTS = new Set([
  'AMULET', // CC / Canton Coin
  'USDCX',
  'CBTC',
]);

export function isVisibleInstrument(id: string): boolean {
  return VISIBLE_INSTRUMENTS.has(id.toUpperCase());
}
