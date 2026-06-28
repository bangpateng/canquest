/** Platform fee ledger rows are audit-only — excluded from user-facing history. */
export function isPlatformFeeTransaction(description: string): boolean {
  return description.startsWith('Platform fee');
}

import type { Prisma } from '@prisma/client';

/**
 * Filter terpusat — dipakai getTransactions & feed notifikasi (FEED_TX_TYPES / badge).
 *
 * HANYA menyembunyikan baris fee (audit-only), BUKAN transfer normal. Fee ditandai tiga cara:
 *   1. referenceId prefix "fee:" — marker eksplisit yang ditulis saat fee row dibuat.
 *   2. description prefix "Platform fee" — backward-compat untuk baris lama.
 *   3. description "Sent N CC claim fee" — claim-fee rows (FCFS/raffle/code) yang ditulis
 *      di quests.service.collectClaimFee.
 *
 * Baris transfer normal TIDAK terkena kondisi ini. Penerima = party fee ditangani tambahan
 * secara post-query via isFeePartyRecipient() (lihat bawah), karena penerima disimpan
 * sebagai short label di referenceId, bukan party id penuh.
 */
export const CC_TRANSACTION_HISTORY_WHERE: Prisma.CcTransactionWhereInput = {
  NOT: {
    OR: [
      /** Fee marker (A3) — penanda tahan banting yang ditulis di party.controller.ts. */
      { referenceId: { startsWith: 'fee:' } },
      /** Legacy fee rows: deskripsi diawali "Platform fee". */
      { description: { startsWith: 'Platform fee' } },
      /** Claim-fee rows: "Sent N CC claim fee" (FCFS / raffle / code claim). */
      { description: { contains: ' CC claim fee' } },
      /** Balance-sync net rows (e.g. +17 after FCFS); fee + reward lines are enough. */
      { ledgerTxId: { startsWith: 'inbound-sync:' } },
    ],
  },
};

/**
 * Resolve semua label short (prefix sebelum "::") party fee dari env. Dipakai untuk
 * post-query filtering: baris lama yang penerimanya = party fee tapi tidak bermarker
 * (mis. "Sent to canquest-fee...") ikut disembunyikan.
 *
 * Env fallback mengikuti quests.service.feeTargetPartyId & party.controller fee collect.
 */
export function feePartyLabels(): string[] {
  const ids = [
    process.env.CANTON_FEE_RECIPIENT_PARTY_ID,
    process.env.CANTON_FEE_PARTY_ID,
    process.env.CANTON_VALIDATOR_PARTY_ID,
    process.env.CANTON_APP_PROVIDER_PARTY_ID,
  ];
  const labels = new Set<string>();
  for (const id of ids) {
    const v = id?.trim();
    if (!v) continue;
    const short = v.split('::')[0]?.trim();
    if (short) labels.add(short);
  }
  return [...labels];
}

/**
 * True jika referenceId (counterparty short label) atau counterparty yang di-resolve
 * menunjuk ke party fee. Dipakai setelah query untuk membuang fee transfer keluar yang
 * lolos filter Prisma karena tidak bermarker "fee:" / "claim fee" / "Platform fee".
 *
 * Aman: hanya cocok dengan short label party fee eksak — username biasa tidak akan match
 * selama bukan nama party fee.
 */
export function isFeePartyRecipient(
  referenceId: string | null | undefined,
  resolvedCounterparty: string | null | undefined,
): boolean {
  const labels = feePartyLabels();
  if (labels.length === 0) return false;
  const candidates = [referenceId?.trim(), resolvedCounterparty?.trim()].filter(
    (v): v is string => !!v && v.length > 0,
  );
  // Match short label eksak ATAU prefix "short::" (party id penuh).
  return candidates.some((c) =>
    labels.some((label) => c === label || c.startsWith(`${label}::`)),
  );
}

/**
 * True jika baris CcTransaction adalah platform-fee / claim-fee (bukan send
 * peer-to-peer yang sebenarnya). Dipakai quest send-transaction counter agar
 * "send ke canquest-fee" tidak terhitung sebagai 1 transaksi send.
 *
 * Tiga penanda (identik dengan CC_TRANSACTION_HISTORY_WHERE + isFeePartyRecipient):
 *   1. referenceId prefix "fee:"        — marker eksplisit
 *   2. description "Platform fee…" / "… CC claim fee"  — backward-compat
 *   3. counterparty (referenceId) == short label party fee eksak / "label::"
 */
export function isFeeTransactionRow(
  referenceId: string | null | undefined,
  description: string | null | undefined,
): boolean {
  const ref = referenceId?.trim() ?? '';
  if (ref.startsWith('fee:')) return true;
  const desc = description ?? '';
  if (desc.startsWith('Platform fee')) return true;
  if (desc.includes(' CC claim fee')) return true;
  // Counterparty short label (sebelum "::") == party fee — cakup path yang
  // menyimpan party penerima di referenceId tanpa marker "fee:" (mis. row
  // "Sent to canquest-fee…"). isFeePartyRecipient handle match eksak label.
  return isFeePartyRecipient(ref, ref);
}
