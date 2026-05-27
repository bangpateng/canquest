import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { QuestsService } from '../quests/quests.service';

/** Unauthenticated Earn (campaign) endpoints. */
@Controller('earn/public')
export class EarnPublicController {
  constructor(private readonly quests: QuestsService) {}

  /** Public campaign detail (no session required). */
  @SkipThrottle()
  @Get(':campaignId')
  getCampaignPublic(@Param('campaignId') campaignId: string) {
    return this.quests.getQuest(campaignId);
  }
}

