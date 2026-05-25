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

  @Get('leaderboard')
  leaderboard(
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
}
