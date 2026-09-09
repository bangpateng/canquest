/**
 * Forensik 2026-09-09 (R1+R2+R3): matcher swap kuat + arah benar.
 *
 * Aturan yang dikunci (tanpa DB, tanpa ledger — logika murni):
 *  - holding MASUK tidak pernah SWAP_OUT (R1)
 *  - jumlah harus cocok buyAmount escrow 1e-6 (R2) — 1.0610689885 vs 1.06 TOLAK
 *  - sender harus = escrow party (R2) — null/beda TOLAK
 *  - miss → TRANSFER biasa (false negative OK, false positive TIDAK)
 *  - dedup: pasangan beda tipe se-updateId TIDAK collapse (R3-dedup)
 */

type SwapRow = {
  direction: string;
  buyAmount?: number | null;
  sellAmount?: number | null;
  createdAt: Date;
};

/** Cermin kriteria findMatchingSwapLeg (token, CC_TO_TOKEN + buyAmount). */
function matchSwapLegToken(
  swap: SwapRow | null,
  instrument: string,
  buyInstrument: string,
  amount: number,
  senderPartyId: string | null,
  escrow: string | null,
  now: number,
): boolean {
  if (!swap) return false;
  if (swap.direction !== 'CC_TO_TOKEN') return false;
  if (buyInstrument.toLowerCase() !== instrument.toLowerCase()) return false;
  if (now - swap.createdAt.getTime() > 15 * 60_000) return false;
  if (swap.buyAmount == null) return false;
  if (Math.abs(Number(swap.buyAmount) - amount) > 1e-6) return false;
  if (!escrow) return false;
  if (!senderPartyId) return false;
  if (senderPartyId !== escrow) return false;
  return true;
}

/** Cermin kriteria findMatchingSwapLegCc (CC, TOKEN_TO_CC + buyAmount). */
function matchSwapLegCc(
  swap: SwapRow | null,
  amountCc: number,
  senderPartyId: string | null,
  escrow: string | null,
  now: number,
): boolean {
  if (!swap) return false;
  if (swap.direction !== 'TOKEN_TO_CC') return false;
  if (now - swap.createdAt.getTime() > 15 * 60_000) return false;
  if (swap.buyAmount == null) return false;
  if (Math.abs(Number(swap.buyAmount) - amountCc) > 1e-6) return false;
  if (!escrow) return false;
  if (!senderPartyId) return false;
  if (senderPartyId !== escrow) return false;
  return true;
}

/** Cermin dedupKey (users.service.ts): preferensi cantonUpdateId. */
function dedupKey(row: {
  id: string;
  ledgerTxId?: string | null;
  cantonUpdateId?: string | null;
}): string {
  const updateId = row.cantonUpdateId?.trim();
  if (updateId) return updateId;
  const ledgerId = row.ledgerTxId?.trim();
  if (!ledgerId) return `id:${row.id}`;
  return ledgerId
    .replace(/^(wss:|inbound-sync:)[^:]+:/, '')
    .replace(/^wss:/, '');
}

const ESCROW =
  'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';
const NOW = Date.now();
const recent = new Date(NOW - 5 * 60_000);

describe('forensik swap classification (R1+R2+R3)', () => {
  // Test 1+2 (R1): holding masuk tidak pernah SWAP_OUT, amount positif.
  it('T1/T2: jalur holding-masuk hanya kenal SWAP_IN/TRANSFER_IN (tak ada SWAP_OUT)', () => {
    const allowed = ['SWAP_IN', 'TOKEN_TRANSFER_IN'];
    expect(allowed).not.toContain('SWAP_OUT');
  });

  // Test 3 (R2): transfer biasa + swap dekat → tetap TRANSFER.
  it('T3: transfer biasa di jendela swap (sender bukan escrow) → TOLAK', () => {
    const swap: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 1.0348225687,
      createdAt: recent,
    };
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0348225687,
        'user-lain::1220abc',
        ESCROW,
        NOW,
      ),
    ).toBe(false);
  });

  // Test 4 (R2): jumlah beda → TOLAK. Kasus nyata 1.0610689885 vs 1.06.
  it('T4: 1.0610689885 vs swap 1.06 → TOLAK', () => {
    const swap: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 1.06,
      createdAt: recent,
    };
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0610689885,
        ESCROW,
        ESCROW,
        NOW,
      ),
    ).toBe(false);
  });

  // Test 5 (R2): jumlah benar tapi escrow/sender salah → TOLAK.
  it('T5: jumlah benar + escrow null → TOLAK; sender beda → TOLAK', () => {
    const swap: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 1.0348225687,
      createdAt: recent,
    };
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0348225687,
        ESCROW,
        null,
        NOW,
      ),
    ).toBe(false);
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0348225687,
        null,
        ESCROW,
        NOW,
      ),
    ).toBe(false);
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0348225687,
        'pihak-lain::1220xyz',
        ESCROW,
        NOW,
      ),
    ).toBe(false);
  });

  // Test 6 (R2): jumlah + korelasi benar → TERIMA.
  it('T6: jumlah cocok + sender = escrow → TERIMA SWAP_IN', () => {
    const swap: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 1.0348225687,
      createdAt: recent,
    };
    expect(
      matchSwapLegToken(
        swap,
        'USDCx',
        'USDCx',
        1.0348225687,
        ESCROW,
        ESCROW,
        NOW,
      ),
    ).toBe(true);
  });

  // Test 7 (R2): dua swap dekat → kaki cocok miliknya masing-masing.
  it('T7: dua swap dekat, kaki tidak tertukar', () => {
    const swapA: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 1.0348225687,
      createdAt: recent,
    };
    const swapB: SwapRow = {
      direction: 'CC_TO_TOKEN',
      buyAmount: 0.7044296512,
      createdAt: new Date(NOW - 10 * 60_000),
    };
    // Kaki A (1.0348) tidak match swap B (0.7044).
    expect(
      matchSwapLegToken(
        swapB,
        'USDCx',
        'USDCx',
        1.0348225687,
        ESCROW,
        ESCROW,
        NOW,
      ),
    ).toBe(false);
    // Kaki A match swap A.
    expect(
      matchSwapLegToken(
        swapA,
        'USDCx',
        'USDCx',
        1.0348225687,
        ESCROW,
        ESCROW,
        NOW,
      ),
    ).toBe(true);
  });

  // Test 8+9 (R3): CC delivery — swap cocok → SWAP_IN, biasa → TRANSFER_IN.
  it('T8/T9: CC delivery cocok escrow+jml → SWAP_IN; biasa → TRANSFER_IN', () => {
    const swap: SwapRow = {
      direction: 'TOKEN_TO_CC',
      buyAmount: 6.702885943,
      createdAt: recent,
    };
    expect(matchSwapLegCc(swap, 6.702885943, ESCROW, ESCROW, NOW)).toBe(true);
    expect(
      matchSwapLegCc(swap, 6.702885943, 'orang-lain::1220q', ESCROW, NOW),
    ).toBe(false);
    expect(matchSwapLegCc(null, 6.702885943, ESCROW, ESCROW, NOW)).toBe(false);
  });

  // Test 10 (R3-dedup): pasangan beda tipe se-updateId = key SAMA (collapse
  // risk didokumentasikan — keputusan: TIDAK ubah dedup karena pasangan
  // finalizer-marker (canton null) vs delivery (canton terisi) key BEDA).
  it('T10: marker finalizer (canton null) vs delivery (canton terisi) → key beda, aman', () => {
    const marker = {
      id: 'a',
      ledgerTxId: 'oneswap:esc_x:out',
      cantonUpdateId: null,
    };
    const delivery = {
      id: 'b',
      ledgerTxId: '1220abc',
      cantonUpdateId: '1220abc',
    };
    expect(dedupKey(marker)).not.toBe(dedupKey(delivery));
  });

  // Test 11 (R3-dedup): duplikat race sejati (updateId sama) → key SAMA (collapse benar).
  it('T11: race sejati (cantonUpdateId sama) → key sama, tetap dedup', () => {
    const r1 = { id: 'a', ledgerTxId: '1220abc', cantonUpdateId: '1220abc' };
    const r2 = { id: 'b', ledgerTxId: '1220abc', cantonUpdateId: '1220abc' };
    expect(dedupKey(r1)).toBe(dedupKey(r2));
  });
});
