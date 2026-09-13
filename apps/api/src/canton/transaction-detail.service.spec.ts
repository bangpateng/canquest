/**
 * Unit test TransactionDetailService — fokus perilaku baru yang membedakan
 * "janji" (offer pending) dari "fakta" (TX final):
 *
 *  1. Baris PENDING dengan CID → detail menempelkan info offer dari LEDGER,
 *     plus peran user (sender/receiver). Ini yang membuat UI merender detail
 *     ledger offer alih-alih receipt TX.
 *  2. Offer sudah tidak ada di ledger (baris DB telat ter-flip) → offer null,
 *     sehingga UI jatuh ke TX biasa (tidak "pending selamanya").
 *  3. Pemilihan id ledger: cantonUpdateId (update ACCEPT saat settle) menang
 *     atas ledgerTxId (update CREATE-OFFER). Tanpa ini, baris yang sudah
 *     di-accept tetap menautkan tx offer lama.
 */
import { TransactionDetailService } from './transaction-detail.service';

type Mocks = {
  service: TransactionDetailService;
  ledger: {
    lookupOfferDetailBothDirections: jest.Mock;
    fetchTransactionByUpdateId: jest.Mock;
    findUpdateIdForContract: jest.Mock;
  };
  prisma: {
    ccTransaction: { findFirst: jest.Mock; update: jest.Mock };
    tokenTransaction: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
  };
};

const OFFER_CID = '00'.padEnd(64, 'a');
const UPDATE_CREATE_OFFER = `1220${'b'.repeat(60)}`;
const UPDATE_ACCEPT = `1220${'c'.repeat(60)}`;
const SENDER = 'canquest-user-sender::1220' + 'd'.repeat(60);
const RECEIVER = 'canquest-user-receiver::1220' + 'e'.repeat(60);

function makeService(): Mocks {
  const ledger = {
    lookupOfferDetailBothDirections: jest.fn().mockResolvedValue(null),
    fetchTransactionByUpdateId: jest.fn().mockResolvedValue(null),
    findUpdateIdForContract: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    ccTransaction: { findFirst: jest.fn(), update: jest.fn() },
    tokenTransaction: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const users = {
    resolveTransferCounterparty: jest.fn().mockResolvedValue(null),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new TransactionDetailService(
    prisma as never,
    ledger as never,
    users as never,
    config as never,
  );
  return { service, ledger, prisma };
}

function ledgerOffer(overrides: Record<string, unknown> = {}) {
  return {
    type: 'transfer_instruction',
    contractId: OFFER_CID,
    sender: SENDER,
    receiver: RECEIVER,
    amount: '0.0100000000',
    description: 'test tx',
    expiresAt: '2026-09-13T07:48:15.102Z',
    createdAt: '2026-09-12T07:48:15.102Z',
    instrumentId: 'USDCx',
    instrumentAdmin: 'admin::1220' + 'f'.repeat(60),
    ...overrides,
  };
}

describe('TransactionDetailService — pending offer', () => {
  describe('token row', () => {
    it('PENDING + offer hidup di ledger → offer & offerRole penerima', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.tokenTransaction.findFirst.mockResolvedValue({
        id: 'tok1',
        userId: 'u1',
        instrumentId: 'USDCx',
        instrumentAdmin: '',
        amount: 0.01,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'PENDING',
        description: 'test tx',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_CREATE_OFFER,
        transferInstructionCid: OFFER_CID,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmount: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: RECEIVER });
      ledger.lookupOfferDetailBothDirections.mockResolvedValue(ledgerOffer());

      const detail = await service.getDetailForUser('u1', 'tok-tok1');

      expect(detail.status).toBe('PENDING');
      expect(detail.offer).not.toBeNull();
      expect(detail.offer?.contractId).toBe(OFFER_CID);
      expect(detail.offer?.instrumentId).toBe('USDCx');
      expect(detail.offerRole).toBe('receiver');
      // Lookup memakai kedua arah supaya offer milik sender pun ketemu.
      expect(ledger.lookupOfferDetailBothDirections).toHaveBeenCalledWith(
        OFFER_CID,
        RECEIVER,
      );
    });

    it('peran pengirim terdeteksi dari party id (case-insensitive)', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.tokenTransaction.findFirst.mockResolvedValue({
        id: 'tok2',
        userId: 'u1',
        instrumentId: 'USDCx',
        instrumentAdmin: '',
        amount: -0.01,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'PENDING',
        description: 'test tx',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_CREATE_OFFER,
        transferInstructionCid: OFFER_CID,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmount: null,
      });
      prisma.user.findUnique.mockResolvedValue({
        cantonPartyId: SENDER.toUpperCase(),
      });
      ledger.lookupOfferDetailBothDirections.mockResolvedValue(ledgerOffer());

      const detail = await service.getDetailForUser('u1', 'tok-tok2');

      expect(detail.offerRole).toBe('sender');
    });

    it('offer sudah dikonsumsi di ledger → offer null (fallback TX biasa)', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.tokenTransaction.findFirst.mockResolvedValue({
        id: 'tok3',
        userId: 'u1',
        instrumentId: 'USDCx',
        instrumentAdmin: '',
        amount: 0.01,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'PENDING',
        description: 'test tx',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_CREATE_OFFER,
        transferInstructionCid: OFFER_CID,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmount: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: RECEIVER });
      ledger.lookupOfferDetailBothDirections.mockResolvedValue(null);

      const detail = await service.getDetailForUser('u1', 'tok-tok3');

      expect(detail.offer).toBeNull();
      expect(detail.offerRole).toBeNull();
    });

    it('kegagalan ledger tidak menggagalkan detail (non-fatal)', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.tokenTransaction.findFirst.mockResolvedValue({
        id: 'tok4',
        userId: 'u1',
        instrumentId: 'USDCx',
        instrumentAdmin: '',
        amount: 0.01,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'PENDING',
        description: 'test tx',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_CREATE_OFFER,
        transferInstructionCid: OFFER_CID,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmount: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: RECEIVER });
      ledger.lookupOfferDetailBothDirections.mockRejectedValue(
        new Error('ledger down'),
      );

      const detail = await service.getDetailForUser('u1', 'tok-tok4');

      expect(detail.offer).toBeNull();
      expect(detail.status).toBe('PENDING');
    });

    it('status COMPLETED tidak pernah menempelkan offer', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.tokenTransaction.findFirst.mockResolvedValue({
        id: 'tok5',
        userId: 'u1',
        instrumentId: 'USDCx',
        instrumentAdmin: '',
        amount: 0.01,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'COMPLETED',
        description: 'test tx',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_ACCEPT,
        transferInstructionCid: OFFER_CID,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmount: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: SENDER });

      const detail = await service.getDetailForUser('u1', 'tok-tok5');

      expect(detail.offer).toBeNull();
      expect(ledger.lookupOfferDetailBothDirections).not.toHaveBeenCalled();
    });
  });

  describe('CC row', () => {
    it('cantonUpdateId (update ACCEPT) dipakai untuk link, bukan ledgerTxId', async () => {
      const { service, prisma } = makeService();
      prisma.ccTransaction.findFirst.mockResolvedValue({
        id: 'cc1',
        userId: 'u1',
        amountMicroCc: -10_000n,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        description: 'send',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: UPDATE_ACCEPT,
        transferInstructionCid: OFFER_CID,
        settledAt: new Date('2026-09-12T08:25:16Z'),
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmountCc: null,
        cancelledInstrumentId: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: SENDER });

      const detail = await service.getDetailForUser('u1', 'cc1');

      // eventId = update ACCEPT (settle), bukan update create-offer.
      expect(detail.eventId).toBe(UPDATE_ACCEPT);
      expect(detail.cantonScanUrl).toContain(encodeURIComponent(UPDATE_ACCEPT));
    });

    it('UPDATE ASLI di ledgerTxId tidak di-resolve sebagai contract id', async () => {
      const { service, ledger, prisma } = makeService();
      prisma.ccTransaction.findFirst.mockResolvedValue({
        id: 'cc2',
        userId: 'u1',
        amountMicroCc: -10_000n,
        type: 'TRANSFER_OUT',
        status: 'PENDING',
        description: 'send',
        referenceId: RECEIVER,
        ledgerTxId: UPDATE_CREATE_OFFER,
        cantonUpdateId: null,
        transferInstructionCid: OFFER_CID,
        settledAt: null,
        createdAt: new Date('2026-09-12T07:48:27Z'),
        cancelledAmountCc: null,
        cancelledInstrumentId: null,
      });
      prisma.user.findUnique.mockResolvedValue({ cantonPartyId: SENDER });
      ledger.lookupOfferDetailBothDirections.mockResolvedValue(ledgerOffer());

      await service.getDetailForUser('u1', 'cc2');

      // ledgerTxId sudah updateId → lazy-resolve contract id harus dilewati.
      expect(ledger.findUpdateIdForContract).not.toHaveBeenCalled();
    });
  });
});
