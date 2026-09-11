/**
 * Unit test swap-legs — identitas kaki CC swap dari baris history.
 * Bentuk data diambil dari history @airplanestar (produksi) supaya terkunci
 * pada pola nyata: kaki swap selalu ber-referenceId party escrow OneSwap.
 */
import {
  isSwapEscrowReference,
  isSwapCcLeg,
  swapCcLegMicro,
  SWAP_ESCROW_PREFIX,
} from './swap-legs';

const ESCROW =
  'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';
const CQ_USER =
  'canquest-user-9bd3d1a7820c::1220d2d3f8c8a2f2e2e9e7b8af6900f62c6210c7e3905ba40b7afa34678b695cdfc6';

describe('swap-legs', () => {
  it('mengenali referenceId escrow OneSwap', () => {
    expect(isSwapEscrowReference(ESCROW)).toBe(true);
    expect(isSwapEscrowReference(CQ_USER)).toBe(false);
    expect(isSwapEscrowReference(null)).toBe(false);
    expect(SWAP_ESCROW_PREFIX).toBe('oneswap-wallet');
  });

  it('kaki jual CC (SWAP_OUT → escrow) = kaki swap', () => {
    expect(
      isSwapCcLeg({
        type: 'SWAP_OUT',
        amountMicroCc: -10_420_000n,
        referenceId: ESCROW,
      }),
    ).toBe(true);
  });

  it('kaki beli CC pada TOKEN_TO_CC (TRANSFER_IN ← escrow) = kaki swap', () => {
    // Inilah kasus yang dulu terlewat: kaki masuk bertipe TRANSFER_IN.
    expect(
      isSwapCcLeg({
        type: 'TRANSFER_IN',
        amountMicroCc: 8_692_454n,
        referenceId: ESCROW,
      }),
    ).toBe(true);
  });

  it('transfer P2P (bukan escrow) BUKAN kaki swap', () => {
    expect(
      isSwapCcLeg({
        type: 'TRANSFER_IN',
        amountMicroCc: 15_000_000n,
        referenceId: CQ_USER,
      }),
    ).toBe(false);
    expect(
      isSwapCcLeg({
        type: 'TRANSFER_OUT',
        amountMicroCc: -15_000_000n,
        referenceId: CQ_USER,
      }),
    ).toBe(false);
  });

  it('tipe non-pergerakan (mis. CC_LOCK) walau ada ref escrow → bukan swap', () => {
    expect(
      isSwapCcLeg({
        type: 'CC_LOCK',
        amountMicroCc: -8_000_000n,
        referenceId: ESCROW,
      }),
    ).toBe(false);
  });

  it('besar CC selalu absolut (jual negatif → positif)', () => {
    expect(
      swapCcLegMicro({
        type: 'SWAP_OUT',
        amountMicroCc: -10_420_000n,
        referenceId: ESCROW,
      }),
    ).toBe(10_420_000n);
    expect(
      swapCcLegMicro({
        type: 'TRANSFER_IN',
        amountMicroCc: 8_692_454n,
        referenceId: ESCROW,
      }),
    ).toBe(8_692_454n);
  });
});
