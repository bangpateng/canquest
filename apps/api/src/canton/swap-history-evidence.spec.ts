/**
 * L60 Fase A/B/C: senderHint raw-event, aturan escrow, lifecycle
 * offer-PENDING, label self-change. Semua pure-function mirror (tanpa DB).
 */

const ESCROW =
  'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';
const USER = 'canquest-user-7fd3df003453::1220a5e003d34981573be4bc35737d6b78176e7117af28e80c90ec339a0262b92260';
const DSO = 'DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc';

/** Cermin deriveSenderHint: acting/witness pertama non-receiver non-system. */
function deriveSenderHint(
  createdOwners: string[],
  exercised: Array<{ actingParties?: string[]; witnessParties?: string[] }>,
  isSystem: (p: string) => boolean,
): string | null {
  const receivers = new Set(createdOwners);
  for (const ex of exercised) {
    for (const p of [...(ex.actingParties ?? []), ...(ex.witnessParties ?? [])]) {
      if (!p || receivers.has(p) || isSystem(p)) continue;
      return p;
    }
  }
  return null;
}

const isSystem = (p: string) => {
  if (p.startsWith('canquest:')) return true;
  const lower = p.toLowerCase();
  return (
    lower.startsWith('dso') ||
    lower.startsWith('cantex') ||
    lower.startsWith('bridge-operator')
  );
};

/** Cermin aturan escrow L60-A2: party `::` diterima, hex updateId ditolak. */
function escrowFromRef(ref: string | null): string | null {
  const r = ref?.trim() || null;
  return r && r.includes('::') ? r : null;
}

/** Cermin deteksi offer-created B1: created offer + tanpa Accept. */
function detectOfferCid(
  created: Array<{ contractId: string; templateId: string }>,
  exercisedChoices: string[],
): string | null {
  if (exercisedChoices.includes('TransferInstruction_Accept')) return null;
  for (const o of created) {
    const t = o.templateId || '';
    if (t.includes(':TransferOffer') || t.includes(':TransferInstruction')) {
      return o.contractId;
    }
  }
  return null;
}

/** Cermin label self-change C. */
function ccDescription(opts: {
  isSwapIn: boolean;
  refundMatch: boolean;
  senderNull: boolean;
  selfActed: boolean;
}): string {
  if (opts.isSwapIn) return 'swap';
  if (opts.refundMatch) return 'refund';
  if (opts.senderNull && opts.selfActed) return 'change';
  return 'received';
}

describe('swap history evidence fixes (L60 A/B/C)', () => {
  it('A1: senderHint = escrow dari actingParties (kasus 122080fb nyata)', () => {
    expect(
      deriveSenderHint(
        [USER],
        [{ actingParties: [USER], witnessParties: ['Bridge-Operator::1220x', USER, ESCROW] }],
        isSystem,
      ),
    ).toBe(ESCROW);
  });

  it('A1: null bila hanya receiver + system (tidak menebak)', () => {
    expect(
      deriveSenderHint([USER], [{ actingParties: [USER], witnessParties: [DSO] }], isSystem),
    ).toBeNull();
    expect(deriveSenderHint([USER], [], isSystem)).toBeNull();
  });

  it('A2: referenceId hex updateId DITOLAK, party escrow DITERIMA', () => {
    expect(escrowFromRef('1220c17dbf43c543cab24d1')).toBeNull();
    expect(escrowFromRef(ESCROW)).toBe(ESCROW);
    expect(escrowFromRef(null)).toBeNull();
  });

  it('B1: offer-created tanpa Accept → PENDING + cid', () => {
    const cid = detectOfferCid(
      [
        { contractId: 'cid-hold', templateId: 'pkg:Utility.Registry.Holding.V0.Holding:Holding' },
        { contractId: 'cid-offer', templateId: 'pkg:Utility.Registry.App.V0.Model.Transfer:TransferOffer' },
      ],
      ['AllocationFactory_TransferInternal'],
    );
    expect(cid).toBe('cid-offer');
  });

  it('B1: update berisi Accept → bukan PENDING (langsung COMPLETED/flip)', () => {
    expect(
      detectOfferCid(
        [{ contractId: 'cid-offer', templateId: 'pkg:Transfer:TransferOffer' }],
        ['TransferInstruction_Accept'],
      ),
    ).toBeNull();
  });

  it('B1: tanpa created offer → bukan PENDING', () => {
    expect(
      detectOfferCid(
        [{ contractId: 'cid-hold', templateId: 'pkg:Holding:Holding' }],
        [],
      ),
    ).toBeNull();
  });

  it('C: self-change hanya bila sender null + self acted transfer', () => {
    expect(
      ccDescription({ isSwapIn: false, refundMatch: false, senderNull: true, selfActed: true }),
    ).toBe('change');
    expect(
      ccDescription({ isSwapIn: false, refundMatch: false, senderNull: true, selfActed: false }),
    ).toBe('received');
    expect(
      ccDescription({ isSwapIn: false, refundMatch: false, senderNull: false, selfActed: true }),
    ).toBe('received');
    expect(
      ccDescription({ isSwapIn: true, refundMatch: false, senderNull: true, selfActed: true }),
    ).toBe('swap');
  });

  it('D: kaki jual ikut arah — TOKEN_TO_CC ke tabel token (bukan CC)', () => {
    // Cermin cabang settleSwapOutcome: arah menentukan penulis tabel.
    const writerFor = (direction: string) =>
      direction === 'TOKEN_TO_CC' ? 'token' : 'cc';
    expect(writerFor('TOKEN_TO_CC')).toBe('token');
    expect(writerFor('CC_TO_TOKEN')).toBe('cc');
    // Kasus nyata 07:47: sell 1.76 USDCx (token) + buy 13.119 CC.
    // Kaki jual token TIDAK boleh lahir sebagai "-1.76 CC".
    const sellTable = writerFor('TOKEN_TO_CC');
    expect(sellTable).not.toBe('cc');
  });
});
