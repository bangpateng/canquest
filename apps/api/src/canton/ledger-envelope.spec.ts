/**
 * Normalisasi envelope TERSIMPAN (LedgerUpdate.envelope) — dua bentuk:
 *   (1) flat raw-ingest live: { created, archived, exercised }
 *   (2) backfill historis:    { events: [{ ExercisedEvent }, { CreatedEvent }] }
 *
 * Regresi yang dijaga: tool rekonstruksi lama hanya membaca bentuk (1) → untuk
 * baris backfill (mayoritas data historis) terlihat NOL event, padahal lengkap.
 */
import { normalizeStoredEnvelope } from './ledger-envelope';

describe('normalizeStoredEnvelope', () => {
  it('bentuk flat raw-ingest: meneruskan created/archived/exercised apa adanya', () => {
    const env = {
      updateId: '1220abc',
      created: [
        { contractId: 'c1', templateId: 'X:Amulet', createArgument: {} },
      ],
      archived: [{ contractId: 'a1', templateId: 'X:Amulet' }],
      exercised: [
        { contractId: 'e1', templateId: 'X:Transfer', choice: 'Accept' },
      ],
    };
    const out = normalizeStoredEnvelope(env);
    expect(out.created).toHaveLength(1);
    expect(out.archived).toHaveLength(1);
    expect(out.exercised).toHaveLength(1);
    expect(out.exercised[0].choice).toBe('Accept');
  });

  it('bentuk backfill events[] PascalCase: memecah wrapper ke kind yang benar', () => {
    const env = {
      updateId: '1220def',
      events: [
        {
          ExercisedEvent: {
            contractId: 'e1',
            templateId: 'X:T',
            choice: 'TransferFactory_Transfer',
          },
        },
        { CreatedEvent: { contractId: 'c1', templateId: 'X:Amulet' } },
        { ArchivedEvent: { contractId: 'a1', templateId: 'X:Amulet' } },
      ],
    };
    const out = normalizeStoredEnvelope(env);
    expect(out.exercised.map((e) => e.contractId)).toEqual(['e1']);
    expect(out.created.map((c) => c.contractId)).toEqual(['c1']);
    expect(out.archived.map((a) => a.contractId)).toEqual(['a1']);
  });

  it('bentuk backfill lowercase di dalam events[] juga dikenali', () => {
    const env = {
      events: [{ created: { contractId: 'c9', templateId: 'X:Amulet' } }],
    };
    expect(normalizeStoredEnvelope(env).created).toHaveLength(1);
  });

  it('menggabungkan kedua bentuk tanpa menggandakan event yang sama', () => {
    const env = {
      created: [{ contractId: 'c1', templateId: 'X:Amulet' }],
      events: [
        { CreatedEvent: { contractId: 'c1', templateId: 'X:Amulet' } },
        { CreatedEvent: { contractId: 'c2', templateId: 'X:Amulet' } },
      ],
    };
    const out = normalizeStoredEnvelope(env);
    expect(out.created.map((c) => c.contractId)).toEqual(['c1', 'c2']);
  });

  it('envelope null / shape tak dikenal → array kosong (bukan throw)', () => {
    expect(normalizeStoredEnvelope(null).created).toEqual([]);
    expect(normalizeStoredEnvelope(undefined).exercised).toEqual([]);
    expect(normalizeStoredEnvelope({}).archived).toEqual([]);
    expect(normalizeStoredEnvelope({ events: 'bukan-array' }).created).toEqual(
      [],
    );
  });
});
