/**
 * Reassignment (update varian ke-4 di /v2/updates) — parser murni.
 *
 * Kontrak (terverifikasi dari OpenAPI JsReassignment + codec JsSchema):
 *  - Bentuk: { update: { Reassignment: { value: { updateId, offset,
 *    recordTime, synchronizerId, events:[...] } } } }
 *  - events[] oneOf by key: JsAssignmentEvent (flatten) | JsUnassignedEvent
 *    (punya wrapper `value`).
 *  - Sisi assigned: identitas + witness ada di dalam createdEvent.
 *  - Sisi unassigned: field langsung di event, TANPA createArgument.
 *
 * Tujuan: (1) majukan checkpoint agar update ini tidak di-replay terus,
 * (2) simpan raw audit. BUKAN untuk proyeksi saldo — assigned membawa
 * CreatedEvent lengkap tapi kontraknya sudah ada (double-count kalau
 * di-dispatch ke handler balance/leg).
 */
import { parseReassignment } from './canton-updates.service';

const SRC = 'global-synchronizer::1220src';
const TGT = 'global-synchronizer::1220tgt';
const USER = 'karel::1220abc';

function frame(events: unknown[]): Record<string, unknown> {
  return {
    update: {
      Reassignment: {
        value: {
          updateId: '1220reassign',
          offset: 2180853,
          recordTime: '2026-09-10T10:00:00Z',
          synchronizerId: TGT,
          events,
        },
      },
    },
  };
}

describe('parseReassignment', () => {
  it('R1: assigned event → identitas diambil dari createdEvent', () => {
    const parsed = parseReassignment(
      frame([
        {
          JsAssignmentEvent: {
            source: SRC,
            target: TGT,
            reassignmentId: 'ra-1',
            submitter: USER,
            reassignmentCounter: 3,
            createdEvent: {
              contractId: 'cid-holding',
              templateId: 'hash:Splice.Amulet:Amulet',
              createArgument: { owner: USER, amount: { initialAmount: '5' } },
              witnessParties: [USER],
            },
          },
        },
      ]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.offsetKnown).toBe(true);
    expect(parsed!.offset).toBe(2180853);
    expect(parsed!.updateId).toBe('1220reassign');
    expect(parsed!.synchronizerId).toBe(TGT);
    expect(parsed!.parties).toEqual([USER]);
    expect(parsed!.events).toHaveLength(1);
    expect(parsed!.events[0]).toMatchObject({
      kind: 'assigned',
      contractId: 'cid-holding',
      templateId: 'hash:Splice.Amulet:Amulet',
      witnessParties: [USER],
    });
    // Payload mentah dipertahankan (sumber forensik).
    expect(
      (parsed!.events[0].payload.createdEvent as { contractId: string })
        .contractId,
    ).toBe('cid-holding');
  });

  it('R2: unassigned event — field langsung di wrapper `value`, tanpa createdEvent', () => {
    const parsed = parseReassignment(
      frame([
        {
          JsUnassignedEvent: {
            value: {
              reassignmentId: 'ra-1',
              contractId: 'cid-holding',
              templateId: 'hash:Splice.Amulet:Amulet',
              source: SRC,
              target: TGT,
              reassignmentCounter: 3,
              witnessParties: [USER],
              packageName: 'splice-amulet',
              offset: 2180853,
              nodeId: 0,
            },
          },
        },
      ]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.events).toHaveLength(1);
    expect(parsed!.events[0]).toMatchObject({
      kind: 'unassigned',
      contractId: 'cid-holding',
      templateId: 'hash:Splice.Amulet:Amulet',
      witnessParties: [USER],
    });
    expect(parsed!.parties).toEqual([USER]);
  });

  it('R3: mixed assigned+unassigned → eventIndex positional 0..n, party digabung', () => {
    const parsed = parseReassignment(
      frame([
        {
          JsUnassignedEvent: {
            value: {
              contractId: 'cid-a',
              templateId: 't',
              witnessParties: ['a::1220'],
            },
          },
        },
        {
          JsAssignmentEvent: {
            source: SRC,
            target: TGT,
            createdEvent: {
              contractId: 'cid-b',
              templateId: 't',
              witnessParties: ['b::1220', 'a::1220'],
            },
          },
        },
      ]),
    );
    expect(parsed!.events.map((e) => e.kind)).toEqual([
      'unassigned',
      'assigned',
    ]);
    expect(parsed!.events.map((e) => e.eventIndex)).toEqual([0, 1]);
    expect(parsed!.parties.sort()).toEqual(['a::1220', 'b::1220']);
  });

  it('R4: bukan reassignment → null (tidak menelan frame Transaction)', () => {
    expect(parseReassignment({})).toBeNull();
    expect(
      parseReassignment({ update: { Transaction: { value: { updateId: 'x' } } } }),
    ).toBeNull();
    expect(
      parseReassignment({ update: { OffsetCheckpoint: { value: { offset: 1 } } } }),
    ).toBeNull();
  });

  it('R5: reassignment tanpa event yang dikenali → null (tidak bikin baris kosong)', () => {
    expect(parseReassignment(frame([]))).toBeNull();
    expect(parseReassignment(frame([{ sesuatu: {} }]))).toBeNull();
  });

  it('R6: offset absen di wire → offsetKnown false (checkpoint TIDAK difake)', () => {
    const parsed = parseReassignment({
      update: {
        Reassignment: {
          value: { updateId: '1220x', events: [{ JsAssignmentEvent: { createdEvent: { contractId: 'c' } } }] },
        },
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.offsetKnown).toBe(false);
    expect(parsed!.offset).toBe(0); // nilai netral; caller cek offsetKnown
  });

  it('R7: hasil parse BUKAN CantonUpdateEvent — tak bisa masuk jalur balance/leg', () => {
    // Sisi assigned membawa CreatedEvent Amulet milik user. Kalau objek ini
    // sampai ke BalanceEventHandler, saldo user naik dua kali (kontrak sudah
    // ada). Kontrak tipe menjaganya: hasilnya tak punya created/archived/
    // exercised yang dibaca handler — hanya `events` raw.
    const parsed = parseReassignment(
      frame([
        {
          JsAssignmentEvent: {
            source: SRC,
            target: TGT,
            createdEvent: {
              contractId: 'cid-holding',
              templateId: 'hash:Splice.Amulet:Amulet',
              createArgument: { owner: USER, amount: { initialAmount: '5' } },
              witnessParties: [USER],
            },
          },
        },
      ]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty(
      'created',
    );
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty(
      'exercised',
    );
  });
});
