import { Controller, Get, Query } from '@nestjs/common';
import { QuestsService } from '../quests/quests.service';

/** Unauthenticated marketing endpoints. */
@Controller('public')
export class PublicController {
  constructor(private readonly quests: QuestsService) {}

  @Get('quests')
  featuredQuests(@Query('limit') limit?: string) {
    const n = Math.min(12, Math.max(1, parseInt(limit ?? '6', 10) || 6));
    return this.quests.listFeaturedQuests(n);
  }
}
