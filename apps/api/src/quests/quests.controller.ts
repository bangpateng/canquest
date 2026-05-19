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
import { QuestStatus } from '@prisma/client';
import { QuestsService } from './quests.service';
import { UsersService } from '../users/users.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('quests')
@UseGuards(AuthGuard('jwt'))
export class QuestsController {
  private readonly logger = new Logger(QuestsController.name);

  constructor(
    private readonly quests: QuestsService,
    private readonly users: UsersService,
    private readonly splice: SpliceValidatorService,
  ) {}

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

        void this.sendQuestReward(user, questId, rewardCc).catch((err: unknown) => {
          this.logger.warn(
            `Quest reward transfer failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

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

  /* ─── Reward helper (async, fire-and-forget) ─── */

  private async sendQuestReward(
    user: { id: string; username: string | null; cantonPartyId: string | null },
    questId: string,
    rewardCc: number,
  ) {
    if (!user.username || !user.cantonPartyId) return;

    // Create offer from validator to user (receiver = user's Party ID)
    const offerContractId = await this.splice.createTransferOffer(
      user.cantonPartyId,
      rewardCc,
      `Quest reward: ${questId}`,
    );

    if (!offerContractId) {
      this.logger.warn(`Quest reward offer creation failed for ${user.username}`);
      return;
    }

    const accepted = await this.splice.acceptOfferViaWallet(offerContractId, user.username);
    this.logger.log(
      `Quest reward ${rewardCc} CC → ${user.username} (accepted: ${String(accepted)})`,
    );

    // Record CC transaction
    await this.users.recordTransaction({
      userId: user.id,
      amountCc: rewardCc,
      type: 'QUEST_REWARD',
      description: `Quest reward: ${questId}`,
    });
  }
}
