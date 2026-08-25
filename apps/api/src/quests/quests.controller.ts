import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { QuestKind, QuestStatus } from '../common/prisma-types';
import { WalletRequiredGuard } from '../common/wallet-required.guard';
import { assertHasRealWallet } from '../common/wallet-policy';
import { ClaimExternalFeeDto } from './dto/claim-external-fee.dto';
import { QuestsService } from './quests.service';
import { UsersService } from '../users/users.service';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { LedgerQueueService } from '../queue/ledger-queue.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('quests')
@UseGuards(AuthGuard('jwt'))
export class QuestsController {
  private readonly logger = new Logger(QuestsController.name);

  constructor(
    private readonly quests: QuestsService,
    private readonly users: UsersService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly ledgerQueue: LedgerQueueService,
    private readonly config: ConfigService,
  ) {}

  private questSubmitRequiresWallet(): boolean {
    const flag = this.config.get<string>('QUEST_SUBMIT_REQUIRES_WALLET');
    if (flag === 'false' || flag === '0') return false;
    return true;
  }

  /** Partner campaigns (Earn menu) require a wallet; Quest hub does not. */
  private async requireWalletForCampaignQuest(
    questId: string,
    userId: string,
  ): Promise<void> {
    const kind = await this.quests.getQuestKind(questId);
    if (kind !== QuestKind.CAMPAIGN) return;
    const user = await this.users.findById(userId);
    assertHasRealWallet(user?.cantonPartyId);
  }

  @SkipThrottle()
  @Get('dashboard-stats')
  async dashboardStats(@Req() req: AuthedReq) {
    return this.quests.getUserDashboardStats(req.user.userId);
  }

  @SkipThrottle()
  @Get()
  @UseGuards(WalletRequiredGuard)
  listQuests(@Query('status') status?: string) {
    const s = Object.values(QuestStatus).includes(status as QuestStatus)
      ? (status as QuestStatus)
      : undefined;
    return this.quests.listQuests(s);
  }

  @Get('my-progress')
  @UseGuards(WalletRequiredGuard)
  async myProgress(@Req() req: AuthedReq) {
    return this.quests.getUserAllProgress(req.user.userId);
  }

  @SkipThrottle()
  @Get('earn-hub')
  getEarnHub() {
    return this.quests.getEarnHubQuest();
  }

  @Get(':questId')
  @UseGuards(WalletRequiredGuard)
  getQuest(@Param('questId') questId: string) {
    return this.quests.getQuest(questId);
  }

  @Get(':questId/progress')
  async questProgress(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
  ) {
    await this.requireWalletForCampaignQuest(questId, req.user.userId);
    const p = await this.quests.getUserProgress(req.user.userId, questId);
    return {
      completed: p.completed,
      allTasksVerified: p.allTasksVerified,
      submissions: p.submissions,
      rewardStatus: p.rewardStatus,
      rewardCc: p.rewardCc,
      cantonLedgerConfigured: p.cantonLedgerConfigured,
      ledger: this.quests.toApiLedgerProof(p.ledger, p.rewardCc),
      campaignMeta: p.campaignMeta,
      sendProgress: p.sendProgress,
    };
  }

  /**
   * Eligibility gate Earn untuk satu campaign (READ-ONLY).
   * Mengembalikan status eligible + alasan untuk badge FE.
   * Tidak throw bila tidak eligible — FE yang menampilkan pesan.
   */
  @Get(':questId/eligibility')
  async questEligibility(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
  ) {
    const user = await this.users.findById(req.user.userId);
    return this.quests.getQuestEligibility(
      req.user.userId,
      questId,
      user?.cantonPartyId ?? null,
    );
  }

  /** FCFS CC — claim fee on-chain + reward from pool (first-come slots). */
  @Post(':questId/claim-fcfs')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 3, ttl: 60_000 } })
  async claimFcfs(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
    @Body() body: ClaimExternalFeeDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };
    return this.quests.claimFcfsReward({
      userId: user.id,
      username: user.username,
      cantonPartyId: user.cantonPartyId,
      questId,
      walletKind: user.walletKind,
      externalFeeTxId: body?.externalFeeTxId,
    });
  }

  /**
   * M3b: langkah 1 klaim FCFS untuk user EXTERNAL — siapkan fee leg untuk
   * ditandatangani browser (precheck penuh agar tanda tangan tidak sia-sia).
   * Setelah sign, frontend memanggil /claim-fcfs dengan externalFeeTxId.
   */
  @Post(':questId/claim-fcfs/prepare-external')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 3, ttl: 60_000 } })
  async prepareExternalFcfsFee(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
  ) {
    return this.quests.prepareExternalFcfsClaimFee(req.user.userId, questId);
  }

  /**
   * M3b: langkah 1 klaim untuk user EXTERNAL — SEMUA tipe campaign
   * (fcfs | draw_cc | invite | cc_code_raffle). Siapkan fee leg untuk
   * ditandatangani browser (precheck penuh per tipe).
   */
  @Post(':questId/claim-external/prepare')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  async prepareExternalClaimFee(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
    @Body() body: { claimType?: string },
  ) {
    const allowed = ['fcfs', 'draw_cc', 'invite', 'cc_code_raffle'] as const;
    const claimType = allowed.find((t) => t === body?.claimType);
    if (!claimType) {
      return {
        message: 'claimType harus salah dari: fcfs, draw_cc, invite, cc_code_raffle',
      };
    }
    return this.quests.prepareExternalClaimFee(
      req.user.userId,
      questId,
      claimType,
    );
  }

  /** Paid claim for invite / waitlist code (2 CC default fee). */
  @Post(':questId/claim-invite')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  async claimInvite(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
    @Body() body: ClaimExternalFeeDto,
  ) {
    await this.requireWalletForCampaignQuest(questId, req.user.userId);
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };
    return this.quests.claimInviteReward({
      userId: user.id,
      username: user.username,
      cantonPartyId: user.cantonPartyId,
      questId,
      walletKind: user.walletKind,
      externalFeeTxId: body?.externalFeeTxId,
    });
  }

  /** Raffle CC — admin draw winner pays claim fee + receives reward CC. */
  @Post(':questId/claim-draw-cc')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 3, ttl: 60_000 } })
  async claimDrawCc(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
    @Body() body: ClaimExternalFeeDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };
    return this.quests.claimDrawCcReward({
      userId: user.id,
      username: user.username,
      cantonPartyId: user.cantonPartyId,
      questId,
      walletKind: user.walletKind,
      externalFeeTxId: body?.externalFeeTxId,
    });
  }

  /** CC + Code combined raffle — admin draw winner pays 5 CC fee, receives CC reward + invite code. */
  @Post(':questId/claim-cc-and-code-raffle')
  @UseGuards(WalletRequiredGuard)
  @Throttle({ ledger: { limit: 3, ttl: 60_000 } })
  async claimCcAndCodeRaffle(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
    @Body() body: ClaimExternalFeeDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };
    return this.quests.claimCcAndCodeRaffleReward({
      userId: user.id,
      username: user.username,
      cantonPartyId: user.cantonPartyId,
      questId,
      walletKind: user.walletKind,
      externalFeeTxId: body?.externalFeeTxId,
    });
  }

  @Post(':questId/tasks/:taskId/submit')
  async submitTask(
    @Param('questId') questId: string,
    @Param('taskId') taskId: string,
    @Req() req: AuthedReq,
    @Body() body: { proof?: string },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };

    const { status, alreadyDone } = await this.quests.submitTask({
      userId: user.id,
      userPartyId: user.cantonPartyId ?? '',
      questId,
      taskId,
      proof: body.proof,
    });

    if (alreadyDone) {
      return { ok: true, status, message: 'Task already completed' };
    }

    if (status === 'VERIFIED' && user.cantonPartyId) {
      void this.featuredActivity
        .recordActivity(
          'task_verified',
          user.cantonPartyId,
          `Task ${taskId} in quest ${questId}`,
        )
        .catch(() => {
          /* non-critical */
        });
    }

    const allTasksVerified = await this.quests.areAllTasksVerified(
      user.id,
      questId,
    );

    return {
      ok: true,
      status,
      message:
        status === 'VERIFIED' ? 'Task verified' : 'Task submitted for review',
      allTasksVerified,
    };
  }

  /**
   * Final quest submit — Web2 completion in DB; optional DAML proof + CIP-56 CC when enabled.
   */
  @Post(':questId/submit')
  async submitQuest(@Param('questId') questId: string, @Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };

    const questKind = await this.quests.getQuestKind(questId);
    await this.requireWalletForCampaignQuest(questId, req.user.userId);

    if (
      questKind === QuestKind.CAMPAIGN &&
      !user.cantonPartyId &&
      this.questSubmitRequiresWallet()
    ) {
      return {
        ok: false,
        message: 'Create your Canton wallet before submitting the quest',
      };
    }

    const result = await this.quests.submitQuest({
      userId: user.id,
      userPartyId: user.cantonPartyId ?? null,
      username: user.username,
      questId,
    });

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        rewardStatus: result.rewardStatus,
      };
    }

    if (user.cantonPartyId) {
      void this.featuredActivity
        .recordActivity(
          'quest_completed',
          user.cantonPartyId,
          `Quest ${questId} submitted`,
        )
        .catch(() => {
          /* non-critical */
        });
    }

    const campaignMeta = await this.quests.getCampaignMeta(questId);
    if (result.rewardCc > 0 && campaignMeta.requiresFcfsClaim) {
      this.logger.log(
        `Skip auto CC enqueue for ${user.username}: FCFS campaign — use Claim (fee) instead`,
      );
    }
    if (
      result.rewardCc > 0 &&
      !campaignMeta.requiresFcfsClaim &&
      !campaignMeta.requiresDrawCcClaim &&
      user.username &&
      user.cantonPartyId
    ) {
      const questTitle = await this.quests.getQuestTitle(questId);
      this.logger.log(
        `Enqueue quest CC reward: ${result.rewardCc} CC → ${user.username}`,
      );
      void this.ledgerQueue
        .enqueueCcReward({
          userId: user.id,
          username: user.username,
          cantonPartyId: user.cantonPartyId,
          amountCc: result.rewardCc,
          description: questTitle,
          referenceId: questId,
        })
        .catch((err: unknown) => {
          this.logger.warn(`Failed to enqueue CC reward: ${String(err)}`);
        });
    }

    return {
      ok: true,
      message: result.message,
      rewardCc: result.rewardCc,
      inviteCode: result.inviteCode,
      rewardStatus: result.rewardStatus,
      ledger: this.quests.toApiLedgerProof(
        result.ledger,
        result.rewardCc,
        result.rewardCc > 0 && !!(user.username && user.cantonPartyId),
      ) ?? {
        enabled: false,
        participationContractId: null,
        completionContractId: null,
        rewardContractId: null,
        taskSubmissionCount: 0,
        cip56Queued: false,
        errors: result.ledger.errors,
      },
    };
  }
}
