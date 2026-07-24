/**
 * Whitelist token yang ditampilkan & dipakai di dapp. Hanya CC (Amulet) +
 * USDCx + CBTC. Token lain dari OneSwap pools (HANDL, MOD, HECTO, FRXUSD.B,
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

/**
 * Whitelist token yang BISA DI-SWAP via OneSwap. Saat ini hanya CC ↔ USDCx
 * (CBTC Coming soon). Lebih sempit dari VISIBLE_INSTRUMENTS (yang juga
 * meng-cover saldo wallet) supaya CBTC tetap tampil di saldo walau tidak
 * bisa di-swap.
 *
 * Dipakai endpoint GET /pools (token picker swap).
 */
export const SWAP_INSTRUMENTS = new Set([
  'AMULET', // CC / Canton Coin
  'USDCX',
]);

export function isSwapInstrument(id: string): boolean {
  return SWAP_INSTRUMENTS.has(id.toUpperCase());
}
