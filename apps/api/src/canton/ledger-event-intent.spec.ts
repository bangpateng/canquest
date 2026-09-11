/**
 * Unit test modul murni ledger-event-intent — pembaca metadata ledger dari
 * event WSS. Nilai meta diambil dari envelope produksi nyata (airplanestar,
 * 2026-09-10) supaya parser terkunci pada bentuk wire sebenarnya.
 */
import {
  readLedgerIntent,
  readSwapMarker,
  hasSwapMarker,
  escrowIdFromReasons,
  isNonValueKind,
  transientContractIds,
  readSwapOutLeg,
  isSelfFundsMovement,
  LEDGER_META,
} from './ledger-event-intent';
import type { CantonUpdateEvent } from './canton-updates.service';

const USER =
  'canquest-user-7fd3df003453::1220a5e003d34981573be4bc35737d6b78176e7117af28e80c90ec339a0262b92260';
const ESCROW =
  'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';

function ev(over: Partial<CantonUpdateEvent> = {}): CantonUpdateEvent {
  return {
    offset: 1,
    offsetKnown: true,
    updateId: '1220abc',
    parties: [USER],
    created: [],
    archived: [],
    exercised: [],
    ...over,
  };
}

/** Rakit exercised event dengan meta.values pada exerciseResult. */
function exMeta(
  choice: string,
  values: Record<string, string>,
  contractId = 'cid-1',
): {
  contractId: string;
  templateId: string;
  choice: string;
  choiceArgument: Record<string, unknown>;
  exerciseResult: unknown;
} {
  return {
    contractId,
    templateId: 'pkg:Splice.Amulet:Amulet',
    choice,
    choiceArgument: {},
    exerciseResult: { meta: { values } },
  };
}

describe('readLedgerIntent', () => {
  it('membaca tx-kind, reason, sender dari exerciseResult.meta.values', () => {
    const intent = readLedgerIntent(
      ev({
        exercised: [
          exMeta('TransferFactory_Transfer', {
            [LEDGER_META.txKind]: 'transfer',
            [LEDGER_META.reason]: 'Swap 10.42 CC → USDCx (OneSwap esc_692334d2ba682e43a62ba613)',
            [LEDGER_META.sender]: USER,
          }),
        ] as never,
      }),
    );
    expect(intent.txKinds).toEqual(['transfer']);
    expect(intent.reasons).toHaveLength(1);
    expect(intent.sender).toBe(USER);
  });

  it('membaca meta dari choiceArgument, extraArgs, dan transferLegSides', () => {
    const intent = readLedgerIntent(
      ev({
        exercised: [
          {
            contractId: 'cid-a',
            templateId: 'pkg:Splice.ExternalPartyConfigState:ExternalPartyConfigState',
            choice: 'EventLog_HoldingsChange',
            choiceArgument: {
              extraArgs: { meta: { values: { [LEDGER_META.reason]: 'holders released lock' } } },
              transferLegSides: [
                { meta: { values: { [LEDGER_META.reason]: 'Swap 1 CC → USDCx (OneSwap esc_abc123)' } } },
              ],
            },
          },
        ] as never,
      }),
    );
    expect(intent.reasons).toContain('holders released lock');
    expect(intent.reasons).toContain('Swap 1 CC → USDCx (OneSwap esc_abc123)');
  });

  it('sender ambigu (2 nilai beda) → null, bukan pilih salah satu', () => {
    const intent = readLedgerIntent(
      ev({
        exercised: [
          exMeta('A', { [LEDGER_META.sender]: USER }),
          exMeta('B', { [LEDGER_META.sender]: ESCROW }),
        ] as never,
      }),
    );
    expect(intent.sender).toBeNull();
  });

  it('tanpa meta → semua kosong, sender null', () => {
    const intent = readLedgerIntent(
      ev({ exercised: [{ contractId: 'c', templateId: 't', choice: 'X', choiceArgument: {} }] as never }),
    );
    expect(intent.txKinds).toEqual([]);
    expect(intent.reasons).toEqual([]);
    expect(intent.sender).toBeNull();
  });
});

describe('readSwapMarker', () => {
  it('parse format produksi: jumlah, instrumen, escrow', () => {
    const m = readSwapMarker(
      'Swap 10.42 CC → USDCx (OneSwap esc_692334d2ba682e43a62ba613)',
    );
    expect(m).toMatchObject({
      isSwap: true,
      escrowId: 'esc_692334d2ba682e43a62ba613',
      sellAmount: '10.42',
      sellInstrument: 'CC',
      buyInstrument: 'USDCx',
    });
  });

  it('panah ASCII "->" juga diterima', () => {
    expect(
      readSwapMarker('Swap 1.247635 USDCx -> CC (OneSwap esc_abcdef)').isSwap,
    ).toBe(true);
  });

  it('TIDAK menebak: reason lain → marker kosong', () => {
    expect(readSwapMarker('holders released lock').isSwap).toBe(false);
    expect(readSwapMarker('Received CC').isSwap).toBe(false);
    expect(readSwapMarker(null).isSwap).toBe(false);
    expect(readSwapMarker(undefined).isSwap).toBe(false);
  });

  it('swap tanpa escrow id → isSwap true, escrowId null (jujur)', () => {
    const m = readSwapMarker('Swap 5 CC → USDCx (OneSwap)');
    expect(m.isSwap).toBe(true);
    expect(m.escrowId).toBeNull();
  });

  it('helper hasSwapMarker / escrowIdFromReasons', () => {
    const reasons = ['holders released lock', 'Swap 2 CC → USDCx (OneSwap esc_deadbeef)'];
    expect(hasSwapMarker(reasons)).toBe(true);
    expect(hasSwapMarker(['no marker'])).toBe(false);
    expect(escrowIdFromReasons(reasons)).toBe('esc_deadbeef');
  });
});

describe('isNonValueKind', () => {
  it('unlock & merge-split = non-value; transfer/mint = value', () => {
    expect(isNonValueKind(['transfer'])).toBe(false);
    expect(isNonValueKind(['mint'])).toBe(false);
    expect(isNonValueKind(['unlock'])).toBe(true);
    expect(isNonValueKind(['merge-split'])).toBe(true);
  });

  it('fail-open: kind tak dikenal tidak dianggap non-value', () => {
    expect(isNonValueKind([])).toBe(false);
    expect(isNonValueKind(['sesuatu-baru'])).toBe(false);
  });
});

describe('transientContractIds', () => {
  it('created + Archive(choice) cid sama → transien', () => {
    const t = transientContractIds(
      ev({
        created: [{ contractId: 'cid-x', templateId: 't', createArgument: {} }] as never,
        exercised: [{ contractId: 'cid-x', templateId: 't', choice: 'Archive', choiceArgument: {} }] as never,
      }),
    );
    expect([...t]).toEqual(['cid-x']);
  });

  it('created + archived[] cid sama → transien', () => {
    const t = transientContractIds(
      ev({
        created: [{ contractId: 'cid-y', templateId: 't', createArgument: {} }] as never,
        archived: [{ contractId: 'cid-y', templateId: 't' }] as never,
      }),
    );
    expect([...t]).toEqual(['cid-y']);
  });

  it('created yang TIDAK dikonsumsi di update sama → bukan transien (credit sah)', () => {
    const t = transientContractIds(
      ev({
        created: [
          { contractId: 'cid-keep', templateId: 't', createArgument: {} },
          { contractId: 'cid-gone', templateId: 't', createArgument: {} },
        ] as never,
        exercised: [{ contractId: 'cid-gone', templateId: 't', choice: 'Archive', choiceArgument: {} }] as never,
      }),
    );
    expect(t.has('cid-keep')).toBe(false);
    expect(t.has('cid-gone')).toBe(true);
  });

  it('kasus produksi 1220b3694878: USER 10.42 transien, escrow persisten', () => {
    const t = transientContractIds(
      ev({
        created: [
          { contractId: '0047a040df0a17b0', templateId: 'pkg:Splice.Amulet:Amulet', createArgument: { owner: USER } },
          { contractId: '000a636f44b59eef', templateId: 'pkg:Splice.Amulet:Amulet', createArgument: { owner: ESCROW } },
        ] as never,
        exercised: [
          { contractId: '0047a040df0a17b0', templateId: 'pkg:Splice.Amulet:Amulet', choice: 'Archive', choiceArgument: {} },
        ] as never,
      }),
    );
    expect(t.has('0047a040df0a17b0')).toBe(true);
    expect(t.has('000a636f44b59eef')).toBe(false);
  });
});

describe('readSwapOutLeg (kaki keluar dari event WSS)', () => {
  // Bentuk wire produksi: update deposit swap CC_TO_TOKEN (122053795599…)
  function depositUpdate(
    transfer: Record<string, unknown>,
    choice = 'TransferFactory_Transfer',
  ): CantonUpdateEvent {
    return ev({
      exercised: [
        {
          contractId: 'cid-rules',
          templateId: 'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
          choice,
          choiceArgument: { transfer },
        },
      ] as never,
    });
  }

  const SWAP_TRANSFER = {
    amount: '10.4200000000',
    sender: USER,
    receiver: ESCROW,
    meta: {
      values: {
        [LEDGER_META.reason]:
          'Swap 10.42 CC → USDCx (OneSwap esc_692334d2ba682e43a62ba613)',
      },
    },
  };

  it('O1: transfer + marker + sender → leg OUT lengkap', () => {
    const leg = readSwapOutLeg(depositUpdate(SWAP_TRANSFER));
    expect(leg).not.toBeNull();
    expect(leg).toMatchObject({
      sender: USER,
      amount: '10.4200000000',
      receiver: ESCROW,
      instrument: 'CC',
      escrowId: 'esc_692334d2ba682e43a62ba613',
    });
  });

  it('O2: tanpa penanda swap → null (bukan kaki keluar swap)', () => {
    const leg = readSwapOutLeg(
      depositUpdate({ ...SWAP_TRANSFER, meta: { values: {} } }),
    );
    expect(leg).toBeNull();
  });

  it('O3: Accept tanpa transfer args → null (bukan kaki keluar)', () => {
    const leg = readSwapOutLeg(
      depositUpdate({}, 'TransferInstruction_Accept'),
    );
    expect(leg).toBeNull();
  });

  it('O4: sender dipertahankan apa adanya — pemfilteran user ada di handler', () => {
    // readSwapOutLeg netral: ia melaporkan siapa pengirimnya. Handler lalu
    // resolveUserByParty(sender) → escrow bukan user Canquest → dilewati.
    const leg = readSwapOutLeg(
      depositUpdate({ ...SWAP_TRANSFER, sender: ESCROW }),
    );
    expect(leg).not.toBeNull();
    expect(leg!.sender).toBe(ESCROW);
  });

  it('O5: marker tanpa escrow id → isSwap tetap, escrowId null', () => {
    const leg = readSwapOutLeg(
      depositUpdate({
        ...SWAP_TRANSFER,
        meta: { values: { [LEDGER_META.reason]: 'Swap 5 CC → USDCx (OneSwap)' } },
      }),
    );
    expect(leg).not.toBeNull();
    expect(leg!.escrowId).toBeNull();
  });

  it('O6: update tanpa exercised → null', () => {
    expect(readSwapOutLeg(ev())).toBeNull();
  });
});

describe('readLedgerIntent — sumber sender urutan parser resmi', () => {
  it('delivery token tanpa meta → sender dari choiceArgument.transfer.sender', () => {
    // Produksi 12207833aa1c…: TransferRule_TwoStepTransfer sender=escrow,
    // receiver=USER, amount=0.695 — TANPA meta sama sekali.
    const intent = readLedgerIntent(
      ev({
        exercised: [
          {
            contractId: 'cid-rule',
            templateId: 'pkg:Utility.Registry.V0.Rule.Transfer:TransferRule',
            choice: 'TransferRule_TwoStepTransfer',
            choiceArgument: {
              transfer: { sender: ESCROW, receiver: USER, amount: '0.6952488883' },
            },
          },
        ] as never,
      }),
    );
    expect(intent.sender).toBe(ESCROW);
  });

  it('meta sender dan transfer.sender sama → tetap satu nilai (tidak ambigu)', () => {
    const intent = readLedgerIntent(
      ev({
        exercised: [
          {
            contractId: 'cid-a',
            templateId: 't',
            choice: 'TransferFactory_Transfer',
            choiceArgument: {
              transfer: { sender: ESCROW, meta: { values: { [LEDGER_META.sender]: ESCROW } } },
            },
          },
        ] as never,
      }),
    );
    expect(intent.sender).toBe(ESCROW);
  });

  it('meta sender ≠ transfer.sender → ambigu → null (jujur)', () => {
    const intent = readLedgerIntent(
      ev({
        exercised: [
          {
            contractId: 'cid-a',
            templateId: 't',
            choice: 'X',
            choiceArgument: {
              transfer: { sender: ESCROW, meta: { values: { [LEDGER_META.sender]: USER } } },
            },
          },
        ] as never,
      }),
    );
    expect(intent.sender).toBeNull();
  });
});

describe('isSelfFundsMovement', () => {
  it('unlock/expire acted by party → true (dana sendiri)', () => {
    expect(
      isSelfFundsMovement(
        [{ choice: 'LockedAmulet_OwnerExpireLockV2', actingParties: [USER] }],
        USER,
      ),
    ).toBe(true);
    expect(
      isSelfFundsMovement(
        [{ choice: 'LockedAmulet_UnlockV2', actingParties: [USER, 'DSO::x'] }],
        USER,
      ),
    ).toBe(true);
  });

  it('choice lain / aktor bukan party → false', () => {
    expect(
      isSelfFundsMovement([{ choice: 'TransferFactory_Transfer', actingParties: [USER] }], USER),
    ).toBe(false);
    expect(
      isSelfFundsMovement([{ choice: 'LockedAmulet_UnlockV2', actingParties: ['DSO::x'] }], USER),
    ).toBe(false);
    expect(isSelfFundsMovement(undefined, USER)).toBe(false);
  });
});
