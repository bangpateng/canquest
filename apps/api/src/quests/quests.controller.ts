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
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { QuestStatus } from '../common/prisma-types';
import { QuestsService } from './quests.service';
import { UsersService } from '../users/users.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
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
    private readonly splice: SpliceValidatorService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly ledgerQueue: LedgerQueueService,
  ) {}

    /* ─── Leaderboard ─── */

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

  /* ─── User dashboard stats + activity ─── */

  @Get('dashboard-stats')
  async dashboardStats(@Req() req: AuthedReq) {
    return this.quests.getUserDashboardStats(req.user.userId);
  }

  @Get('activity')
  async recentActivity(
    @Req() req: AuthedReq,
    @Query('limit') limit?: string,
  ) {
    const l = Math.min(20, Math.max(1, parseInt(limit ?? '8', 10) || 8));
    return this.quests.getRecentActivity(req.user.userId, l);
  }

  /* ─── Public quest list ─── */

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

  @Get(':questId')
  getQuest(@Param('questId') questId: string) {
    return this.quests.getQuest(questId);
  }

  @Get(':questId/progress')
  questProgress(@Param('questId') questId: string, @Req() req: AuthedReq) {
    return this.quests.getUserProgress(req.user.userId, questId);
  }

  /* ─── Submit a task ─── */

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

    // After submitting, check if the whole quest is now complete
    let rewardInfo: { justCompleted: boolean; rewardCc: number } | null = null;
    if (status === 'VERIFIED') {
      // Emit FeaturedAppActivityMarker for task verification
      // Per Canton Module 4: each meaningful user action earns app rewards
      // https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker
      if (user.cantonPartyId) {
        void this.featuredActivity
          .recordActivity('task_verified', user.cantonPartyId, `Task ${taskId} in quest ${questId}`)
          .catch(() => { /* non-critical */ });
      }

      const { justCompleted, rewardMicroCc } =
        await this.quests.checkAndCompleteQuest({
          userId: user.id,
          questId,
        });

      if (justCompleted && rewardMicroCc > 0n && user.username) {
        // Send CC reward via validator
        const rewardCc = Number(rewardMicroCc) / 1_000_000;
        this.logger.log(
          `Sending quest reward: ${rewardCc} CC → ${user.username}`,
        );

        // Emit FeaturedAppActivityMarker for quest completion
        if (user.cantonPartyId) {
          void this.featuredActivity
            .recordActivity('quest_completed', user.cantonPartyId, `Quest ${questId} completed`)
            .catch(() => { /* non-critical */ });
        }

                // Enqueue ke BullMQ — tidak fire-and-forget lagi
        // BullMQ akan retry otomatis jika ledger error
        if (user.username && user.cantonPartyId) {
          void this.ledgerQueue.enqueueCcReward({
            userId: user.id,
            username: user.username,
            cantonPartyId: user.cantonPartyId,
            amountCc: rewardCc,
            description: `Quest reward: ${questId}`,
            referenceId: questId,
          }).catch((err: unknown) => {
            this.logger.warn(`Failed to enqueue CC reward: ${String(err)}`);
          });
        }

        rewardInfo = { justCompleted: true, rewardCc };
      } else if (justCompleted) {
        rewardInfo = { justCompleted: true, rewardCc: 0 };
      }
    }

    return {
      ok: true,
      status,
      message:
        status === 'VERIFIED' ? 'Task verified' : 'Task submitted for review',
      rewardInfo,
    };
  }

    // sendQuestReward dihapus — digantikan oleh LedgerQueueService.enqueueCcReward()
}
