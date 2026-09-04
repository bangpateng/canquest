/**
 * Kebijakan resume stream /v2/updates — PURE FUNCTION (L2b) supaya cabang
 * pruned-gap bisa diuji unit dengan nilai yang disuntik, tanpa menyalakan
 * service ataupun menyentuh node.
 *
 * Kontrak offset (docs Canton Finding & Reading Data):
 *   - `beginExclusive = X` → stream mengirim update dengan offset > X.
 *   - `participantPrunedUpToInclusive = P` → semua update offset ≤ P sudah
 *     dipangkas node; permintaan awal yang sah adalah beginExclusive = P.
 *
 * Aturan (menggantikan aturan 48-jam yang lama):
 *   1. Tidak ada baris checkpoint → mulai dari ledgerEnd (live tail; tidak
 *      ada yang pernah dikonsumsi, tidak ada gap).
 *   2. Checkpoint > ledgerEnd → ledger ter-reset/berpindah node → mulai dari
 *      ledgerEnd, tidak ada gap yang bisa dipertanggungjawabkan.
 *   3. Checkpoint ≤ prunedUpToInclusive → SEBAGIAN riwayat TIDAK BISA
 *      di-replay: offset (checkpoint, pruned] hilang permanen. Kembalikan
 *      rentang gap agar caller mencatatnya ke DB (LedgerStreamGap) dengan
 *      timestamp, lalu resume dari pruned (bukan ledgerEnd!) — sisanya
 *      (pruned, ledgerEnd] tetap di-replay.
 *   4. Checkpoint > pruned → normal: resume dari checkpoint, penuh.
 *
 * Tidak ada lagi batas umur checkpoint: downtime berapa pun pun direplay
 * selama datanya belum dipangkas node.
 */

export interface ResumeDecisionInput {
  /** Offset terakhir yang dipersist (LedgerStreamCheckpoint.lastOffset). */
  checkpointOffset: number | null;
  /** HEAD ledger saat ini (ledger-end). */
  ledgerEnd: number;
  /** Batas pruning node (participantPrunedUpToInclusive). */
  prunedUpToInclusive: number;
}

export interface ResumeGapRange {
  /** Offset pertama yang hilang (inklusif). */
  fromOffset: number;
  /** Offset terakhir yang hilang (inklusif). */
  toOffset: number;
}

export interface ResumeDecision {
  /** Offset beginExclusive untuk subscribe. null = caller pakai ledgerEnd. */
  resumeFrom: number | null;
  /** Hanya terisi bila ada rentang yang diketahui hilang (kasus 3). */
  gap: ResumeGapRange | null;
  /** Alasan keputusan — untuk log + pengujian. */
  reason:
    | 'no-checkpoint'
    | 'ledger-reset'
    | 'checkpoint-behind-pruning'
    | 'normal-resume';
}

export function decideResume(
  input: ResumeDecisionInput,
): ResumeDecision {
  const { checkpointOffset, ledgerEnd, prunedUpToInclusive } = input;

  if (checkpointOffset === null) {
    return { resumeFrom: null, gap: null, reason: 'no-checkpoint' };
  }
  if (checkpointOffset > ledgerEnd) {
    return { resumeFrom: null, gap: null, reason: 'ledger-reset' };
  }
  if (checkpointOffset <= prunedUpToInclusive) {
    // Rentang (checkpoint, min(pruned, ledgerEnd)] tidak bisa di-replay.
    const toOffset = Math.min(prunedUpToInclusive, ledgerEnd);
    return {
      resumeFrom: prunedUpToInclusive,
      gap:
        checkpointOffset + 1 <= toOffset
          ? { fromOffset: checkpointOffset + 1, toOffset }
          : null,
      reason: 'checkpoint-behind-pruning',
    };
  }
  return { resumeFrom: checkpointOffset, gap: null, reason: 'normal-resume' };
}
