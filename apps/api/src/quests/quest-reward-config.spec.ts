import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  defaultClaimFeeCc,
  fcfsSlotsTakenCount,
  formatFcfsSlotsRemainingLabel,
  resolveClaimFeeCc,
} from './quest-reward-config';
import { ClaimFeeSettingsService } from './claim-fee-settings.service';
import { QuestsService } from './quests.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { UsersService } from '../users/users.service';
import { PointsService } from '../users/points.service';
import { TwitterApiService } from '../twitter/twitter-api.service';
import { TwitterCacheService } from '../twitter/twitter-cache.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import { TokenInstrumentHelper } from '../canton/token-instrument.helper';
import { SigningRelayService } from '../canton/signing-relay.service';
import { ClaimOfferService } from '../canton/v30/claim-offer.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 1) Pure helper reward-config (fee & slot FCFS).
 * 2) Gerbang awal claimFcfsReward — validasi sebelum UANG bergerak:
 *    wallet, tipe campaign, campaign ended, tasks tuntas.
 */

describe('quest-reward-config (pure helpers)', () => {
  it('defaultClaimFeeCc matches active campaign defaults', () => {
    expect(defaultClaimFeeCc('CC_ONLY')).toBe(1);
    expect(defaultClaimFeeCc('CC_MANUAL')).toBe(1);
    expect(defaultClaimFeeCc('INVITE_CODE_FCFS')).toBe(0.5);
    expect(defaultClaimFeeCc('INVITE_CODE_RANDOM')).toBe(0.5);
    expect(defaultClaimFeeCc('CC_AND_CODE_RAFFLE')).toBe(1);
    expect(defaultClaimFeeCc('WAITLIST_EMAIL')).toBeNull();
  });

  it('fcfsSlotsTakenCount — slot terisi tidak melebihi max', () => {
    expect(fcfsSlotsTakenCount(7, 10)).toBe(3);
    expect(fcfsSlotsTakenCount(0, 10)).toBe(10);
    expect(fcfsSlotsTakenCount(0, 0)).toBe(1); // maxWinners 0 → guard minimal 1 slot
    expect(fcfsSlotsTakenCount(99, 10)).toBe(0); // over-claim → clamp 0
  });

  it('formatFcfsSlotsRemainingLabel — habis = Ended', () => {
    expect(formatFcfsSlotsRemainingLabel(0, 10)).toBe('Ended');
    expect(formatFcfsSlotsRemainingLabel(5, 10)).toMatch(/5/);
  });

  it('defaultClaimFeeCc menghormati setting global dari admin', () => {
    const settings = { tokenFeeCc: 7, codeFeeCc: 4, combinedFeeCc: 6 };
    expect(defaultClaimFeeCc('CC_ONLY', settings)).toBe(7);
    expect(defaultClaimFeeCc('CC_MANUAL', settings)).toBe(7);
    expect(defaultClaimFeeCc('INVITE_CODE_FCFS', settings)).toBe(4);
    expect(defaultClaimFeeCc('CC_AND_CODE_RAFFLE', settings)).toBe(6);
    expect(defaultClaimFeeCc('WAITLIST_EMAIL', settings)).toBeNull();
  });

  it('resolveClaimFeeCc — fee eksplisit per-campaign selalu menang', () => {
    const settings = { tokenFeeCc: 7, codeFeeCc: 4, combinedFeeCc: 6 };
    expect(
      resolveClaimFeeCc({ claimFeeCc: 0.01, rewardType: 'CC_ONLY' }, settings),
    ).toBe(0.01);
    // 0 = fee eksplisit "tanpa fee" (null); kosong = setting global.
    expect(
      resolveClaimFeeCc({ claimFeeCc: 0, rewardType: 'CC_ONLY' }, settings),
    ).toBeNull();
    expect(
      resolveClaimFeeCc({ claimFeeCc: null, rewardType: 'CC_ONLY' }, settings),
    ).toBe(7);
  });
});

describe('QuestsService.claimFcfsReward — gerbang claim (pre-money)', () => {
  let service: QuestsService;
  let prisma: {
    quest: { findUnique: jest.Mock };
    questSubmission: { findMany: jest.Mock };
  };

  function makeQuest(over: Record<string, unknown> = {}) {
    return {
      id: 'q-1',
      questKind: 'CAMPAIGN',
      rewardType: 'CC_ONLY',
      rewardCc: 25,
      rewardToken: 'CC',
      maxWinners: 10,
      endsAt: new Date(Date.now() + 86_400_000),
      tasks: [],
      ...over,
    };
  }

  beforeEach(() => {
    prisma = {
      quest: { findUnique: jest.fn() },
      questSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const stub = <T>(): T => ({}) as T;
    service = new QuestsService(
      prisma as unknown as PrismaService,
      stub<QuestLedgerService>(),
      stub<CantonLedgerService>(),
      stub<UsersService>(),
      stub<PointsService>(),
      stub<TwitterApiService>(),
      stub<TwitterCacheService>(),
      stub<SpliceValidatorService>(),
      stub<CcInboundSyncService>(),
      new ConfigService(),
      stub<R2StorageService>(),
      stub<LockEligibilityService>(),
      stub<TokenInstrumentHelper>(),
      stub<SigningRelayService>(),
      stub<ClaimOfferService>(),
      stub<ClaimFeeSettingsService>(),
    );
  });

  it('tanpa wallet Canton → BadRequest sebelum menyentuh quest', async () => {
    await expect(
      service.claimFcfsReward({
        userId: 'u1',
        username: null,
        cantonPartyId: null,
        questId: 'q-1',
      }),
    ).rejects.toThrow(/Create your Canton wallet/);
    expect(prisma.quest.findUnique).not.toHaveBeenCalled();
  });

  it('quest tidak ada → NotFound', async () => {
    prisma.quest.findUnique.mockResolvedValue(null);
    await expect(
      service.claimFcfsReward({
        userId: 'u1',
        username: 'arie',
        cantonPartyId: 'p::1',
        questId: 'q-404',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('bukan campaign FCFS CC → BadRequest', async () => {
    prisma.quest.findUnique.mockResolvedValue(
      makeQuest({ rewardType: 'WAITLIST_EMAIL' }),
    );
    await expect(
      service.claimFcfsReward({
        userId: 'u1',
        username: 'arie',
        cantonPartyId: 'p::1',
        questId: 'q-1',
      }),
    ).rejects.toThrow(/does not use FCFS/);
  });

  it('campaign sudah ended → BadRequest', async () => {
    prisma.quest.findUnique.mockResolvedValue(
      makeQuest({ endsAt: new Date(Date.now() - 1_000) }),
    );
    await expect(
      service.claimFcfsReward({
        userId: 'u1',
        username: 'arie',
        cantonPartyId: 'p::1',
        questId: 'q-1',
      }),
    ).rejects.toThrow(/has ended/);
  });

  it('tasks belum tuntas → BadRequest (tidak boleh bayar reward prematur)', async () => {
    prisma.quest.findUnique.mockResolvedValue(
      makeQuest({
        tasks: [{ id: 't1' }, { id: 't2' }],
      }),
    );
    // Hanya t1 terverifikasi.
    prisma.questSubmission.findMany.mockResolvedValue([
      { taskId: 't1', status: 'VERIFIED' },
    ]);

    await expect(
      service.claimFcfsReward({
        userId: 'u1',
        username: 'arie',
        cantonPartyId: 'p::1',
        questId: 'q-1',
      }),
    ).rejects.toThrow(/Complete all missions/);
  });
});
