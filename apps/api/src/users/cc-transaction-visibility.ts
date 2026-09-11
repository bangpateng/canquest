/** Platform fee ledger rows are audit-only — excluded from user-facing history. */
export function isPlatformFeeTransaction(description: string): boolean {
  return description.startsWith('Platform fee');
}

import type { Prisma } from '@prisma/client';

/**
 * True bila baris ini adalah artefak WSS handler yang TIDAK punya info pengirim
 * asli — ditandai ledgerTxId berprefix "wss:" DAN referenceId = party sendiri.
 * Baris seperti ini tampil sebagai "(You) → (You)" yang membingungkan.
 *
 * Transfer antar user CanQuest & transfer external yang sudah dicatat controller
 * TIDAK terkena (mereka punya ledgerTxId non-wss + referenceId counterparty asli).
 * Hanya baris WSS yang menang/tidak punya kembaran controller yang di-hide.
 *
 * Dipakai post-query (butuh partyId owner — tidak bisa di Prisma where).
 */
export function isSelfReferenceWssRow(
  referenceId: string | null | undefined,
  ledgerTxId: string | null | undefined,
  ownerPartyId: string | null | undefined,
): boolean {
  const ledger = ledgerTxId?.trim();
  if (!ledger || !ledger.startsWith('wss:')) return false;
  const ref = referenceId?.trim();
  if (!ref || !ownerPartyId) return false;
  // Match short label (sebelum "::") ATAU party id penuh.
  const ownerShort = ownerPartyId.split('::')[0];
  return ref === ownerPartyId || ref === ownerShort;
}

/**
 * Filter terpusat — dipakai getTransactions & feed notifikasi (FEED_TX_TYPES / badge).
 *
 * HANYA menyembunyikan baris fee (audit-only), BUKAN transfer normal. Fee ditandai tiga cara:
 *   1. referenceId prefix "fee:" — marker eksplisit yang ditulis saat fee row dibuat.
 *   2. description prefix "Platform fee" — backward-compat untuk baris lama.
 *   3. description "Sent N CC claim fee" — claim-fee rows (FCFS/raffle/code) yang ditulis
 *      di quests.service.collectClaimFee.
 *   4. `oneswap:<esc>:out` pra-migrasi — baris sintetis SWAP_IN controller yang duplikat
 *      baris delivery WSS (atau artefak token-as-CC). WSS kini menulis KEDUA kaki dengan
 *      identitas ledger, jadi duplikatnya disembunyikan agar satu swap tetap dua kaki.
 *      Baris `oneswap:*:in` (kaki jual lama) TETAP tampil — satu-satunya catatan
 *      penjualan historis pra-migrasi.
 *
 * NULL-SAFE (fix 2026-09-11): `NOT (NULL OR false …)` = NULL di SQL tiga-nilai — bentuk
 * lama membuang diam-diam SEMUA baris ber-referenceId NULL (156/297 baris, termasuk
 * hasil WSS: pengirim luar tidak dikenal, dan leg swap). Baris tanpa referenceId
 * diberi jalur eksplisit; seleksi fee tetap berlaku untuk baris ber-referenceId.
 *
 * Baris transfer normal TIDAK terkena kondisi ini. Penerima = party fee ditangani tambahan
 * secara post-query via isFeePartyRecipient() (lihat bawah), karena penerima disimpan
 * sebagai short label di referenceId, bukan party id penuh.
 */
export const CC_TRANSACTION_HISTORY_WHERE: Prisma.CcTransactionWhereInput = {
  NOT: {
    OR: [
      /**
       * NULL-SAFE (fix 2026-09-11): `referenceId` dan `ledgerTxId` nullable.
       * SQL `NOT(NULL LIKE 'fee:%' OR …)` = NULL → baris ber-referenceId NULL
       * (hasil WSS: pengirim luar tak dikenal, dan leg swap) terbuang diam-
       * diam — 156/297 baris. Setiap kondisi atas kolom nullable diberi guard
       * `IS NOT NULL` agar bernilai false (bukan NULL) untuk baris tersebut.
       */
      {
        AND: [
          { referenceId: { not: null } },
          { referenceId: { startsWith: 'fee:' } },
        ],
      },
      /** description NOT NULL di schema → aman tanpa guard. */
      { description: { startsWith: 'Platform fee' } },
      { description: { contains: ' CC claim fee' } },
      {
        AND: [
          { ledgerTxId: { not: null } },
          { ledgerTxId: { startsWith: 'inbound-sync:' } },
        ],
      },
      /**
       * Pra-migrasi: `oneswap:<esc>:out` — baris sintetis SWAP_IN controller.
       * Duplikat baris delivery WSS (TRANSFER_IN dengan updateId asli) atau
       * artefak token-as-CC. WSS kini menulis KEDUA kaki dengan identitas
       * ledger; sembunyikan agar satu swap tetap dua kaki seperti di explorer.
       * Baris `oneswap:*:in` (kaki jual lama) TETAP tampil — satu-satunya
       * catatan penjualan historis pra-migrasi.
       */
      {
        AND: [
          { ledgerTxId: { not: null } },
          { ledgerTxId: { startsWith: 'oneswap:' } },
          { ledgerTxId: { endsWith: ':out' } },
        ],
      },
      /**
       * Pra-perbaikan b518ceb (3 baris, 1 user): kaki jual TOKEN_TO_CC
       * tertulis di tabel CC dengan denominsi CC ("−1.76 CC" padahal yang
       * dijual USDCx). Kaki benar diregenerasi dari raw layer lewat penulis
       * produksi (scripts/replay-swap-out-legs.ts) sebagai TokenTransaction
       * ber-identitas ledger `swap:<esc>:out:<inst>`. Daftar eksplisit —
       * sengaja TIDAK pola umum, supaya kaki jual CC yang sah tidak ikut
       * tertelan.
       */
      {
        ledgerTxId: {
          in: [
            'oneswap:esc_0f59377e51d6b9789c1a2297:in',
            'oneswap:esc_b1db3c7ba64474c925809b8c:in',
            'oneswap:esc_285ca74f3725ca1a88b8b008:in',
          ],
        },
      },
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
function feePartyLabels(): string[] {
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
