/**
 * swap-legs — identitas LEG SWAP dari baris history DB.
 *
 * Dipakai verifikasi quest/campaign (task swap) supaya membaca SATU baris per
 * swap dari history wallet — bukan menebak dari tabel lain.
 *
 * Fakta ledger (terverifikasi pada envelope /v2/updates):
 *   - Satu swap = dua update (deposit + delivery), dan tiap sisi punya LEG CC
 *     sendiri di history:
 *       CC_TO_TOKEN : kaki CC = PENGIRIMAN CC  → CcTransaction SWAP_OUT (kredit negatif)
 *       TOKEN_TO_CC : kaki CC = PENERIMAAN CC  → CcTransaction TRANSFER_IN (kredit positif)
 *   - Kaki CC swap SELALU ber-referenceId party escrow OneSwap (`oneswap-wallet*`),
 *     diambil dari `choiceArgument.transfer.receiver` (deposit) atau sender
 *     (delivery) — jadi penandanya ledger-derived, bukan tebakan.
 *
 * Kenapa tidak memakai tipe SWAP_IN/SWAP_OUT saja: sejak keputusan produk
 * "hanya kaki keluar berlabel Swap", kaki masuk swap bertipe TRANSFER_IN.
 * Menghitung dari SWAP_IN/SWAP_OUT saja membuat swap TOKEN_TO_CC tidak
 * terhitung sama sekali.
 */

/** Prefix party escrow OneSwap di ledger (hasil observasi party id OneSwap). */
export const SWAP_ESCROW_PREFIX = 'oneswap-wallet';

/** True bila referenceId menunjuk party escrow OneSwap (kaki swap). */
export function isSwapEscrowReference(
  referenceId: string | null | undefined,
): boolean {
  return (referenceId ?? '').trim().startsWith(SWAP_ESCROW_PREFIX);
}

/** Bentuk minimal baris history yang dibutuhkan. */
export interface CcHistoryRow {
  type: string;
  amountMicroCc: bigint | number | string;
  referenceId: string | null;
  status?: string | null;
}

/**
 * True bila baris CcTransaction adalah KAKI CC dari sebuah swap:
 *   - SWAP_OUT ke escrow (CC dijual), atau
 *   - TRANSFER_IN dari escrow (CC dibeli pada TOKEN_TO_CC).
 *
 * Transfer P2P ke/dari sesama user TIDAK cocok (referenceId bukan escrow),
 * jadi tidak pernah terhitung sebagai swap.
 */
export function isSwapCcLeg(row: CcHistoryRow): boolean {
  if (!row.referenceId || !isSwapEscrowReference(row.referenceId)) return false;
  return row.type === 'SWAP_OUT' || row.type === 'TRANSFER_IN';
}

/** Besaran CC (absolut, micro) dari kaki CC swap. */
export function swapCcLegMicro(row: CcHistoryRow): bigint {
  const v = BigInt(row.amountMicroCc ?? 0);
  return v < 0n ? -v : v;
}
