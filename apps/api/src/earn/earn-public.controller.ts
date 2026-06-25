import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { QuestsService } from '../quests/quests.service';

/** Unauthenticated Earn (campaign) endpoints. */
@Controller('earn/public')
export class EarnPublicController {
  constructor(private readonly quests: QuestsService) {}

  /**
   * Konfigurasi gate akses Earn (publik, untuk ditampilkan di card guide FE).
   * Biaya points + jumlah CC lock — kedua-duanya dinamis (AppSetting/env).
   * Dideklarasikan SEBELUM route :campaignId agar tidak tertangkap sebagai param.
   */
  @SkipThrottle()
  @Get('access-config')
  async getAccessConfig() {
    return this.quests.getEarnAccessConfig();
  }

  /** Public campaign detail (no session required). */
  @SkipThrottle()
  @Get(':campaignId')
  getCampaignPublic(@Param('campaignId') campaignId: string) {
    return this.quests.getQuest(campaignId);
  }
}
