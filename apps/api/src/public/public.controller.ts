import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { QuestsService } from '../quests/quests.service';
import { MaintenanceService } from '../common/maintenance.service';

/** Unauthenticated marketing endpoints. */
@Controller('public')
export class PublicController {
  constructor(
    private readonly quests: QuestsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  /**
   * Status mode maintenance (publik, tanpa throttle, tanpa guard).
   * Dipakai frontend (overlay client + middleware Next) untuk menampilkan
   * layar maintenance tanpa membombardir DB — service sudah cache 5 detik.
   */
  @Get('maintenance')
  @SkipThrottle()
  async maintenanceStatus() {
    return this.maintenance.getStatus();
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
