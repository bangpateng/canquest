import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QuestKind, QuestStatus, RewardType } from '../common/prisma-types';

import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import type { QuestSocialLinkInput } from '../quests/quest-social-links.util';

@Controller('admin')
@UseGuards(AuthGuard('admin-jwt'), AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /* ── Dashboard stats ── */

  @Get('stats')
  getStats() {
    return this.admin.getDashboardStats();
  }

  /* ── Quest CRUD ── */

  @Get('quests')
  listQuests(@Query('kind') kind?: string) {
    const k = Object.values(QuestKind).includes(kind as QuestKind)
      ? (kind as QuestKind)
      : undefined;
    return this.admin.listQuests(k);
  }

  @Get('earn-hub')
  getEarnHub() {
    return this.admin.getEarnHubQuest();
  }

  @Post('earn-hub/ensure')
  ensureEarnHub() {
    return this.admin.ensureEarnHubQuest();
  }

  @Get('quests/:questId')
  getQuest(@Param('questId') questId: string) {
    return this.admin.getQuestDetail(questId);
  }

  @Post('quests')
  createQuest(
    @Body()
    body: {
      title: string;
      projectName?: string | null;
      org: string;
      orgSlug: string;
      description: string;
      banner?: string;
      bannerImageUrl?: string | null;
      logoUrl?: string | null;
      rewardCc?: number;
      rewardPool?: string;
      deadline?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      status?: QuestStatus;
      rewardType?: RewardType;
      maxWinners?: number;
      claimFeeCc?: number | null;
      winnerMessage?: string | null;
      tags?: string[];
      socialLinks?: QuestSocialLinkInput[];
      questKind?: QuestKind;
      tasks?: Array<{
        type: string;
        title: string;
        description?: string;
        points?: number;
        target?: string;
        order?: number;
        correctAnswer?: string;
      }>;
    },
  ) {
    return this.admin.createQuest(body);
  }

  @Patch('quests/:questId')
  updateQuest(
    @Param('questId') questId: string,
    @Body()
    body: {
      title?: string;
      projectName?: string | null;
      org?: string;
      orgSlug?: string;
      description?: string;
      banner?: string;
      bannerImageUrl?: string | null;
      logoUrl?: string | null;
      rewardCc?: number;
      rewardPool?: string;
      deadline?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      status?: QuestStatus;
      rewardType?: RewardType;
      maxWinners?: number | null;
      claimFeeCc?: number | null;
      winnerMessage?: string | null;
      tags?: string[];
      socialLinks?: QuestSocialLinkInput[];
    },
  ) {
    return this.admin.updateQuest(questId, body);
  }

  @Delete('quests/:questId')
  deleteQuest(@Param('questId') questId: string) {
    return this.admin.deleteQuest(questId);
  }

  /* ── Task CRUD ── */

  @Post('quests/:questId/tasks')
  addTask(
    @Param('questId') questId: string,
    @Body()
    body: {
      type: string;
      title: string;
      description?: string;
      points?: number;
      target?: string;
      order?: number;
      correctAnswer?: string;
      showNewBadge?: boolean;
      repeatEvery24h?: boolean;
    },
  ) {
    return this.admin.addTask(questId, body);
  }

  @Patch('tasks/:taskId')
  updateTask(
    @Param('taskId') taskId: string,
    @Body()
    body: {
      type?: string;
      title?: string;
      description?: string | null;
      points?: number;
      target?: string | null;
      order?: number;
      correctAnswer?: string | null;
      showNewBadge?: boolean;
      repeatEvery24h?: boolean;
    },
  ) {
    return this.admin.updateTask(taskId, body);
  }

  @Delete('tasks/:taskId')
  deleteTask(@Param('taskId') taskId: string) {
    return this.admin.deleteTask(taskId);
  }

  /* ── Participants ── */

  @Get('quests/:questId/participants')
  getParticipants(@Param('questId') questId: string) {
    return this.admin.getParticipants(questId);
  }

  @Get('quests/:questId/export')
  exportQuestActivity(@Param('questId') questId: string) {
    return this.admin.exportQuestActivity(questId);
  }

  /* ── Winner selection ── */

  @Post('quests/:questId/draw-winners')
  drawWinners(
    @Param('questId') questId: string,
    @Body() body: { count?: number; userIds?: string[] },
  ) {
    return this.admin.drawWinners(questId, body);
  }

  @Get('quests/:questId/winners')
  getWinners(@Param('questId') questId: string) {
    return this.admin.getWinners(questId);
  }

  /* ── Reward distribution ── */

  @Post('quests/:questId/distribute-rewards')
  distributeRewards(
    @Param('questId') questId: string,
    @Body() body: { drawIds?: string[] },
  ) {
    return this.admin.distributeRewards(questId, body.drawIds);
  }

  /* ── Invite codes ── */

  @Post('quests/:questId/invite-codes')
  addInviteCodes(
    @Param('questId') questId: string,
    @Body() body: { codes?: string[]; generateCount?: number; prefix?: string },
  ) {
    const codes =
      body.codes ??
      (body.generateCount
        ? this.admin.generateCodes(body.generateCount, body.prefix)
        : []);
    return this.admin.addInviteCodes(questId, codes);
  }

  @Get('quests/:questId/invite-codes')
  getInviteCodes(@Param('questId') questId: string) {
    return this.admin.getInviteCodes(questId);
  }

  @Delete('quests/:questId/invite-codes/:codeId')
  deleteInviteCode(
    @Param('questId') questId: string,
    @Param('codeId') codeId: string,
  ) {
    return this.admin.deleteInviteCode(questId, codeId);
  }

  @Delete('quests/:questId/invite-codes')
  deleteInviteCodes(@Param('questId') questId: string) {
    return this.admin.deleteInviteCodes(questId);
  }

  /* ── Wallet invite codes (wallet creation) ── */

  @Get('wallet-invites')
  listWalletInvites() {
    return this.admin.listWalletInviteCodes();
  }

  @Post('wallet-invites')
  generateWalletInvites(
    @Body()
    body: { count?: number; codes?: string[]; note?: string },
  ) {
    return this.admin.generateWalletInviteCodes(body);
  }

  @Delete('wallet-invites/:id')
  deleteWalletInvite(@Param('id') id: string) {
    return this.admin.deleteWalletInviteCode(id);
  }

  /* ── User management ── */

  @Get('users')
  listUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
  ) {
    return this.admin.listUsers(
      Number(page ?? 1),
      Number(pageSize ?? 20),
      q,
    );
  }

  @Delete('users/:userId')
  deleteUser(@Param('userId') userId: string) {
    return this.admin.deleteUsers([userId]);
  }

  @Post('users/delete-bulk')
  deleteUsersBulk(@Body() body: { userIds: string[] }) {
    return this.admin.deleteUsers(body.userIds ?? []);
  }

  @Patch('users/:userId/admin')
  setAdmin(
    @Param('userId') userId: string,
    @Body() body: { isAdmin: boolean },
  ) {
    return this.admin.setAdmin(userId, body.isAdmin);
  }
}
