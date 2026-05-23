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
import { QuestStatus } from '../common/prisma-types';
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

  @Get('leaderboard')
  async leaderboard(
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const validPeriod = (['weekly', 'monthly', 'all'] as const).includes(
      period as 'weekly' | 'monthly' | 'all',
    )
      ? (period as 'weekly' | 'monthly' | 'all')
      : 'weekly';
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize ?? '10', 10) || 10));
    return this.quests.getLeaderboard(validPeriod, p, ps);
  }

  @Get('dashboard-stats')
  async dashboardStats(@Req() req: AuthedReq) {
    return this.quests.getUserDashboardStats(req.user.userId);
  }

  @Get('activity')
  async recentActivity(
    @Req() req: AuthedReq,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const ps = limit
      ? Math.min(20, Math.max(1, parseInt(limit, 10) || 5))
      : Math.min(20, Math.max(1, parseInt(pageSize ?? '5', 10) || 5));
    return this.quests.getRecentActivity(req.user.userId, p, ps);
  }

  @Get()
  listQuests(@Query('status') status?: string) {
    const s = Object.values(QuestStatus).includes(status as QuestStatus)
      ? (status as QuestStatus)
      : undefined;
    return this.quests.listQuests(s);
  }

  @Get('my-progress')
  async myProgress(@Req() req: AuthedReq) {
    return this.quests.getUserAllProgress(req.user.userId);
  }

  @Get('earn-hub')
  getEarnHub() {
    return this.quests.getEarnHubQuest();
  }

  /** Project/event name for wallet labels (quest.title). */
  @Get(':questId/title')
  async questTitle(@Param('questId') questId: string) {
    const title = await this.quests.getQuestTitle(questId);
    return { questId, title };
  }

  @Get(':questId')
  getQuest(@Param('questId') questId: string) {
    return this.quests.getQuest(questId);
  }

  @Get(':questId/progress')
  async questProgress(@Param('questId') questId: string, @Req() req: AuthedReq) {
    const p = await this.quests.getUserProgress(req.user.userId, questId);
    return {
      completed: p.completed,
      allTasksVerified: p.allTasksVerified,
      submissions: p.submissions,
      rewardStatus: p.rewardStatus,
      rewardCc: p.rewardCc,
      cantonLedgerConfigured: p.cantonLedgerConfigured,
      ledger: this.quests.toApiLedgerProof(p.ledger, p.rewardCc),
    };
  }

  @Get(':questId/reward-status')
  async rewardStatus(@Param('questId') questId: string, @Req() req: AuthedReq) {
    return this.quests.getQuestRewardStatus(req.user.userId, questId);
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
        .recordActivity('task_verified', user.cantonPartyId, `Task ${taskId} in quest ${questId}`)
        .catch(() => { /* non-critical */ });
    }

    const allTasksVerified = await this.quests.areAllTasksVerified(user.id, questId);

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
  async submitQuest(
    @Param('questId') questId: string,
    @Req() req: AuthedReq,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };

    if (!user.cantonPartyId && this.questSubmitRequiresWallet()) {
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
      return { ok: false, message: result.message, rewardStatus: result.rewardStatus };
    }

    if (user.cantonPartyId) {
      void this.featuredActivity
        .recordActivity('quest_completed', user.cantonPartyId, `Quest ${questId} submitted`)
        .catch(() => { /* non-critical */ });
    }

    if (result.rewardCc > 0 && user.username && user.cantonPartyId) {
      const questTitle = await this.quests.getQuestTitle(questId);
      this.logger.log(`Enqueue quest CC reward: ${result.rewardCc} CC → ${user.username}`);
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
        rewardContractId: null,
        taskSubmissionCount: 0,
        cip56Queued: false,
        errors: result.ledger.errors,
      },
    };
  }
}
