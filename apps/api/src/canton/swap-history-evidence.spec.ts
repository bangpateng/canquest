/**
 * L60 Fase A/B/C: senderHint raw-event, aturan escrow, lifecycle
 * offer-PENDING, label self-change. Semua pure-function mirror (tanpa DB).
 */

const ESCROW =
  'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';
const USER = 'canquest-user-7fd3df003453::1220a5e003d34981573be4bc35737d6b78176e7117af28e80c90ec339a0262b92260';
const DSO = 'DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc';

/** Cermin deriveSenderHint baru: kandidat dicocokkan escrow swap aktif.
 *  Tanpa daftar escrow (kosong) + tunggal → langsung; dengan daftar →
 *  harus cocok, else null (jujur miss). */
function deriveSenderHint(
  candidates: string[],
  escrows: string[],
): string | null {
  if (candidates.length === 0) return null;
  if (escrows.length === 0) return candidates.length === 1 ? candidates[0] : null;
  const set = new Set(escrows);
  for (const c of candidates) {
    if (set.has(c)) return c;
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
  it('A1: kandidat tunggal non-system → langsung (tanpa DB)', () => {
    expect(deriveSenderHint([ESCROW], [])).toBe(ESCROW);
  });

  it('A1: ambigu (auth0 + escrow + rep) → cocok escrow, bukan first-match', () => {
    // Kasus nyata 1220a4ff: first-match kena auth0 yang salah.
    expect(
      deriveSenderHint(
        ['auth0_007c6643538f2eadd3e573dd05b9::12205bcc', ESCROW, 'decentralized-usdc-interchain-rep::12208115'],
        [ESCROW],
      ),
    ).toBe(ESCROW);
  });

  it('A1: null bila kosong atau tak ada yang cocok escrow (jujur miss)', () => {
    expect(deriveSenderHint([], [ESCROW])).toBeNull();
    expect(deriveSenderHint(['auth0_007c::1220x'], [ESCROW])).toBeNull();
  });

  it('A2: referenceId hex updateId DITOLAK, party escrow DITERIMA', () => {
    expect(escrowFromRef('1220c17dbf43c543cab24d1')).toBeNull();
    expect(escrowFromRef(ESCROW)).toBe(ESCROW);
    expect(escrowFromRef(null)).toBeNull();
  });

  it('B1: offer-created tanpa Accept → TANPA baris (janji, bukan history)', () => {
    // Cermin aturan accept-1-history: skipReceiverRow = hasOffer && !hasAccept.
    const skipReceiverRow = (hasOffer: boolean, hasAccept: boolean) =>
      hasOffer && !hasAccept;
    expect(skipReceiverRow(true, false)).toBe(true);
    expect(skipReceiverRow(true, true)).toBe(false);
    expect(skipReceiverRow(false, false)).toBe(false);
    // cid offer tetap terdeteksi sebagai penanda rantai audit.
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
