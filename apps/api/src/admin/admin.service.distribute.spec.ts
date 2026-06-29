import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';

/**
 * Unit tests untuk anti-silent-failure fix di AdminService.distributeRewards.
 *
 * Context (bug lama): distributeRewards selalu menulis WinnerDraw.distributed=true
 * meski transfer CC onchain gagal. Akibatnya user tidak bisa retry dan UI bilang
 * "Sent" padahal CC tidak masuk. Sekarang distributed hanya true jika CC benar-benar
 * terkirim, sehingga draw yang gagal tetap "Pending" dan bisa di-retry admin tanpa
 * double-pay (query backend memfilter distributed:false).
 */

type SendRewardResult = {
  ok: boolean;
  pending: boolean;
  rewardTxId?: string;
  transferInstructionCid?: string;
  error?: string;
};

type WinnerDrawUpdateCall = {
  id: string;
  distributed: boolean;
  ledgerTxId?: string;
  distributedAt: Date | null;
};

describe('AdminService.distributeRewards — anti-silent-failure', () => {
  let service: AdminService;
  let prisma: {
    quest: { findUnique: jest.Mock };
    winnerDraw: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let splice: { sendReward: jest.Mock };
  let users: { recordTransaction: jest.Mock };

  const QUEST_ID = 'quest-1';
  const DRAW_ID = 'draw-1';
  const USER_ID = 'user-1';
  const CC_AMOUNT = 5;

  /** Build a draw row shaped like the Prisma include in distributeRewards. */
  function makeDraw(overrides: Partial<{
    id: string;
    userId: string;
    ccAmount: number;
    inviteCode: string | null;
    cantonPartyId: string | null;
    email: string;
  }> = {}) {
    // cantonPartyId defaultnya 'winner::fp', tapi override `null` harus
    // dipertahankan (nullish coalescing akan menelan null → pakai spread eksplisit).
    const party =
      overrides.cantonPartyId === undefined
        ? 'winner::fp'
        : overrides.cantonPartyId;
    return {
      id: overrides.id ?? DRAW_ID,
      userId: overrides.userId ?? USER_ID,
      ccAmount: overrides.ccAmount ?? CC_AMOUNT,
      inviteCode: overrides.inviteCode ?? null,
      user: {
        id: overrides.userId ?? USER_ID,
        email: overrides.email ?? 'winner@test',
        username: 'winner',
        cantonPartyId: party,
      },
    };
  }

  /**
   * Capture every winnerDraw.update call so we can assert the final distributed
   * flag. The atomic claim uses updateMany (returns {count}), the finalization
   * uses update. We only track the finalization update calls here — updateMany
   * is set up in beforeEach to always succeed (count: 1) so the current request
   * wins the claim.
   */
  function trackWinnerDrawUpdates(): WinnerDrawUpdateCall[] {
    const calls: WinnerDrawUpdateCall[] = [];
    prisma.winnerDraw.update.mockImplementation((args: any) => {
      calls.push({
        id: args.where?.id,
        distributed: args.data?.distributed,
        ledgerTxId: args.data?.ledgerTxId,
        distributedAt: args.data?.distributedAt ?? null,
      });
      return Promise.resolve({});
    });
    return calls;
  }

  beforeEach(async () => {
    prisma = {
      quest: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ rewardType: 'CC_ONLY', title: 'Test Quest' }),
      },
      winnerDraw: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        // C3 atomic claim: by default the current request wins the draw
        // (count: 1). Tests can override this to {count: 0} to simulate a
        // concurrent claim that already won.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    splice = { sendReward: jest.fn() };
    users = { recordTransaction: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: SpliceValidatorService, useValue: splice },
        { provide: UsersService, useValue: users },
        { provide: ConfigService, useValue: new ConfigService() },
        { provide: R2StorageService, useValue: {} },
        { provide: QuestLedgerService, useValue: {} },
        { provide: CantonLedgerService, useValue: {} },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  it('marks distributed=true & records tx when sendReward succeeds', async () => {
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    const rewardRes: SendRewardResult = {
      ok: true,
      pending: false,
      rewardTxId: 'tx-ok',
    };
    splice.sendReward.mockResolvedValue(rewardRes);
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates).toHaveLength(1);
    expect(updates[0].distributed).toBe(true);
    expect(updates[0].ledgerTxId).toBe('tx-ok');
    expect(updates[0].distributedAt).toBeInstanceOf(Date);
    expect(users.recordTransaction).toHaveBeenCalledTimes(1);
    expect(users.recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        amountCc: CC_AMOUNT,
        type: 'QUEST_REWARD',
        ledgerTxId: 'tx-ok',
      }),
    );
    expect(result.distributed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].ccSent).toBe(true);
    expect(result.results[0].error).toBeNull();
  });

  it('keeps distributed=false when sendReward throws (retryable, no double-pay)', async () => {
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    splice.sendReward.mockRejectedValue(new Error('ledger unreachable'));
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates).toHaveLength(1);
    // ⬇️ Kunci anti-silent-failure: distributed TIDAK true saat gagal.
    expect(updates[0].distributed).toBe(false);
    expect(updates[0].distributedAt).toBeNull();
    expect(updates[0].ledgerTxId).toBeUndefined();
    // Tidak boleh mencatat transaksi CC yang tidak terkirim.
    expect(users.recordTransaction).not.toHaveBeenCalled();
    expect(result.distributed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].ccSent).toBe(false);
    expect(result.results[0].error).toContain('ledger unreachable');
  });

  it('keeps distributed=false when sendReward returns ok:false', async () => {
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    const rewardRes: SendRewardResult = {
      ok: false,
      pending: false,
      error: 'Sender has no Amulet holdings',
    };
    splice.sendReward.mockResolvedValue(rewardRes);
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates[0].distributed).toBe(false);
    expect(updates[0].distributedAt).toBeNull();
    expect(users.recordTransaction).not.toHaveBeenCalled();
    expect(result.distributed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('Amulet holdings');
  });

  it('handles a mix of success + failure per-draw accurately', async () => {
    prisma.winnerDraw.findMany.mockResolvedValue([
      makeDraw({ id: 'd-ok', email: 'ok@test' }),
      makeDraw({ id: 'd-fail', userId: 'u2', email: 'fail@test' }),
    ]);
    splice.sendReward
      .mockResolvedValueOnce({ ok: true, pending: true, rewardTxId: 'tx-ok' })
      .mockResolvedValueOnce({ ok: false, pending: false, error: 'timeout' });
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates).toHaveLength(2);
    const okUpdate = updates.find((u) => u.id === 'd-ok');
    const failUpdate = updates.find((u) => u.id === 'd-fail');
    expect(okUpdate?.distributed).toBe(true);
    expect(failUpdate?.distributed).toBe(false);
    expect(result.distributed).toBe(1);
    expect(result.failed).toBe(1);
    // recordTransaction hanya untuk yang sukses.
    expect(users.recordTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports failure when winner has no Canton wallet', async () => {
    prisma.winnerDraw.findMany.mockResolvedValue([
      makeDraw({ cantonPartyId: null }),
    ]);
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates[0].distributed).toBe(false);
    expect(splice.sendReward).not.toHaveBeenCalled();
    expect(result.distributed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('Canton wallet');
  });

  it('treats draw with ccAmount=0 as sent (no CC to transfer)', async () => {
    // Mis. winner varian CODE pada CC_AND_CODE_RAFFLE: ccAmount=0, kode di-claim
    // lewat jalur lain. Tidak ada CC untuk dikirim → tidak ada failure.
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw({ ccAmount: 0 })]);
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates[0].distributed).toBe(true);
    expect(splice.sendReward).not.toHaveBeenCalled();
    expect(result.distributed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('does not reprocess draws already filtered out (idempotent retry)', async () => {
    // Query backend memfilter distributed:false — bila tidak ada draw tersisa,
    // hasil kosong dan tidak ada transfer/pembaruan DB.
    prisma.winnerDraw.findMany.mockResolvedValue([]);
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates).toHaveLength(0);
    expect(splice.sendReward).not.toHaveBeenCalled();
    expect(result.distributed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('rejects raffle-type quests (winners must self-claim)', async () => {
    prisma.quest.findUnique.mockResolvedValue({ rewardType: 'CC_MANUAL' });
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);

    await expect(service.distributeRewards(QUEST_ID)).rejects.toThrow(
      BadRequestException,
    );
    expect(splice.sendReward).not.toHaveBeenCalled();
    expect(prisma.winnerDraw.update).not.toHaveBeenCalled();
  });

  // ── C3: atomic claim prevents double payout on concurrent requests ──────────

  it('skips a draw already claimed by a concurrent request (no double-pay)', async () => {
    // Simulate a second admin tab / double-click that won the atomic claim
    // first → updateMany returns count: 0 for THIS request.
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    prisma.winnerDraw.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.distributeRewards(QUEST_ID);

    // CRITICAL: sendReward must NOT be called — CC must not leave the wallet.
    expect(splice.sendReward).not.toHaveBeenCalled();
    // No finalization update either (claim failed → continue before update).
    expect(prisma.winnerDraw.update).not.toHaveBeenCalled();
    // Reported as already-handled, not as a fresh send.
    expect(result.results[0].error).toContain('concurrent');
    expect(result.distributed).toBe(1); // counts as handled, not failed
  });

  it('keeps distributed=false on failure so a later retry can re-claim', async () => {
    // First attempt: claim wins (count:1) but sendReward fails.
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    splice.sendReward.mockResolvedValue({
      ok: false,
      pending: false,
      error: 'insufficient funds',
    });
    const updates = trackWinnerDrawUpdates();

    const result = await service.distributeRewards(QUEST_ID);

    expect(updates[0].distributed).toBe(false); // flipped back → retryable
    expect(result.failed).toBe(1);

    // Simulate the retry: sendReward now succeeds, claim wins again.
    prisma.winnerDraw.findMany.mockResolvedValue([makeDraw()]);
    prisma.winnerDraw.updateMany.mockResolvedValue({ count: 1 });
    splice.sendReward.mockResolvedValue({
      ok: true,
      pending: false,
      rewardTxId: 'tx-retry',
    });
    const updates2: WinnerDrawUpdateCall[] = [];
    prisma.winnerDraw.update.mockImplementation((args: any) => {
      updates2.push({
        id: args.where?.id,
        distributed: args.data?.distributed,
        ledgerTxId: args.data?.ledgerTxId,
        distributedAt: args.data?.distributedAt ?? null,
      });
      return Promise.resolve({});
    });

    const result2 = await service.distributeRewards(QUEST_ID);

    expect(updates2[0].distributed).toBe(true);
    expect(updates2[0].ledgerTxId).toBe('tx-retry');
    expect(result2.distributed).toBe(1);
  });
});
