import { ConfigService } from '@nestjs/config';

import { LedgerJobProcessor, SendCcRewardPayload } from './ledger-job.processor';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fund-safety test untuk worker CC reward (job send-cc-reward).
 *
 * Invariant yang dikunci:
 *   1. GUARD DOUBLE-PAYOUT — bila reward quest/user sudah tercatat punya
 *      ledgerTxId, retry Bull TIDAK boleh mengirim CC lagi.
 *   2. Gagal kirim (CIP-56 error) → throw agar Bull retry, dan TIDAK ada
 *      row transaksi fiktif yang tertulis.
 *   3. DB write gagal SETELAH CC terkirim → TIDAK boleh throw (throw akan
 *      memicu retry → kirim CC ulang = double payout nyata).
 */

function makePayload(over: Partial<SendCcRewardPayload> = {}): SendCcRewardPayload {
  return {
    userId: 'user-1',
    username: 'arie',
    cantonPartyId: 'arie::1220abc',
    amountCc: 10,
    description: 'Quest reward: q-1',
    referenceId: 'q-1',
    ...over,
  };
}

type JobStub = { id: string; data: SendCcRewardPayload; attemptsMade: number };

function makeJob(data: SendCcRewardPayload, attemptsMade = 0): JobStub {
  return { id: 'job-1', data, attemptsMade };
}

describe('LedgerJobProcessor — processSendCcReward (fund-safety)', () => {
  let ledger: { executeTransferFactoryTransfer: jest.Mock };
  let users: { recordTransaction: jest.Mock };
  let prisma: { ccTransaction: { findFirst: jest.Mock } };
  let questLedger: { isConfigured: jest.Mock };
  let processor: LedgerJobProcessor;

  beforeEach(() => {
    ledger = { executeTransferFactoryTransfer: jest.fn() };
    users = { recordTransaction: jest.fn().mockResolvedValue(undefined) };
    prisma = { ccTransaction: { findFirst: jest.fn() } };
    questLedger = { isConfigured: jest.fn().mockReturnValue(false) };

    processor = new LedgerJobProcessor(
      ledger as unknown as CantonLedgerService,
      users as unknown as UsersService,
      prisma as unknown as PrismaService,
      questLedger as unknown as QuestLedgerService,
      new ConfigService(),
    );
  });

  it('GUARD: reward sudah tercatat (retry Bull) → SKIP tanpa kirim CC ulang', async () => {
    prisma.ccTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      ledgerTxId: '1220already-paid',
    });

    await processor.processSendCcReward(
      makeJob(makePayload()) as never,
    );

    expect(ledger.executeTransferFactoryTransfer).not.toHaveBeenCalled();
    expect(users.recordTransaction).not.toHaveBeenCalled();
  });

  it('sukses direct (preapproval aktif) → kirim CC + catat transaksi dengan updateId', async () => {
    prisma.ccTransaction.findFirst.mockResolvedValue(null);
    ledger.executeTransferFactoryTransfer.mockResolvedValue({
      ok: true,
      transferKind: 'direct',
      updateId: '1220tx-success',
    });

    await processor.processSendCcReward(makeJob(makePayload()) as never);

    expect(ledger.executeTransferFactoryTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverPartyId: 'arie::1220abc',
        amountCc: 10,
        identity: 'reward',
      }),
    );
    expect(users.recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        amountCc: 10,
        type: 'QUEST_REWARD',
        ledgerTxId: '1220tx-success',
      }),
    );
  });

  it('sukses pending offer (preapproval OFF) → tetap catat tx, reward via inbox user', async () => {
    prisma.ccTransaction.findFirst.mockResolvedValue(null);
    ledger.executeTransferFactoryTransfer.mockResolvedValue({
      ok: true,
      transferKind: 'offer',
      updateId: '1220tx-offer',
    });

    await processor.processSendCcReward(makeJob(makePayload()) as never);

    expect(users.recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ ledgerTxId: '1220tx-offer' }),
    );
  });

  it('CIP-56 gagal → throw (Bull akan retry) & TIDAK menulis transaksi', async () => {
    prisma.ccTransaction.findFirst.mockResolvedValue(null);
    ledger.executeTransferFactoryTransfer.mockResolvedValue({
      ok: false,
      error: 'INSUFFICIENT_HOLDINGS',
    });

    await expect(
      processor.processSendCcReward(makeJob(makePayload()) as never),
    ).rejects.toThrow(/CIP-0056 transfer unavailable/);

    expect(users.recordTransaction).not.toHaveBeenCalled();
  });

  it('DB write gagal SETELAH CC terkirim → TIDAK throw (anti double-payout)', async () => {
    prisma.ccTransaction.findFirst.mockResolvedValue(null);
    ledger.executeTransferFactoryTransfer.mockResolvedValue({
      ok: true,
      transferKind: 'direct',
      updateId: '1220tx-sent',
    });
    users.recordTransaction.mockRejectedValue(new Error('db down'));

    // Harus resolve, bukan reject — throw akan memicu retry & kirim CC ulang.
    await expect(
      processor.processSendCcReward(makeJob(makePayload()) as never),
    ).resolves.toBeUndefined();
  });
});
