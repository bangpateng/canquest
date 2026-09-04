import { decideResume } from './resume-policy';

/**
 * L2b — unit test cabang pruned dengan nilai yang DISUNTIK (pruned di
 * produksi saat ini 0, jadi cabang ini tidak akan pernah tereksekusi di
 * node nyata; kode yang tidak pernah jalan = kode yang tidak diketahui
 * rusak).
 */
describe('decideResume (kebijakan resume stream /v2/updates)', () => {
  it('tanpa baris checkpoint → mulai dari ledgerEnd, tanpa gap', () => {
    const d = decideResume({ checkpointOffset: null, ledgerEnd: 1000, prunedUpToInclusive: 0 });
    expect(d.resumeFrom).toBeNull();
    expect(d.gap).toBeNull();
    expect(d.reason).toBe('no-checkpoint');
  });

  it('normal: pruned = 0, checkpoint segar → resume dari checkpoint', () => {
    const d = decideResume({ checkpointOffset: 900, ledgerEnd: 1000, prunedUpToInclusive: 0 });
    expect(d.resumeFrom).toBe(900);
    expect(d.gap).toBeNull();
    expect(d.reason).toBe('normal-resume');
  });

  it('normal: checkpoint jauh di belakang TANPA pruning → tetap resume penuh (aturan 48 jam dihapus)', () => {
    const d = decideResume({ checkpointOffset: 10, ledgerEnd: 2_185_000, prunedUpToInclusive: 0 });
    expect(d.resumeFrom).toBe(10);
    expect(d.gap).toBeNull();
    expect(d.reason).toBe('normal-resume');
  });

  it('checkpoint ≤ pruned → gap tercatat + resume dari pruned (bukan ledgerEnd)', () => {
    const d = decideResume({ checkpointOffset: 100, ledgerEnd: 1000, prunedUpToInclusive: 400 });
    expect(d.resumeFrom).toBe(400);
    expect(d.gap).toEqual({ fromOffset: 101, toOffset: 400 });
    expect(d.reason).toBe('checkpoint-behind-pruning');
  });

  it('checkpoint tepat = pruned → tidak ada gap (tidak ada yang hilang), resume dari pruned', () => {
    const d = decideResume({ checkpointOffset: 400, ledgerEnd: 1000, prunedUpToInclusive: 400 });
    expect(d.resumeFrom).toBe(400);
    expect(d.gap).toBeNull();
    expect(d.reason).toBe('checkpoint-behind-pruning');
  });

  it('pruned melewati ledgerEnd (edge) → gap dipotong di ledgerEnd, tidak negatif', () => {
    const d = decideResume({ checkpointOffset: 100, ledgerEnd: 300, prunedUpToInclusive: 999 });
    expect(d.resumeFrom).toBe(999);
    expect(d.gap).toEqual({ fromOffset: 101, toOffset: 300 });
    expect(d.reason).toBe('checkpoint-behind-pruning');
  });

  it('checkpoint > ledgerEnd → ledger reset, mulai dari ledgerEnd tanpa gap', () => {
    const d = decideResume({ checkpointOffset: 5000, ledgerEnd: 1000, prunedUpToInclusive: 0 });
    expect(d.resumeFrom).toBeNull();
    expect(d.gap).toBeNull();
    expect(d.reason).toBe('ledger-reset');
  });
});
