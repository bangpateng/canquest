import { Global, Module } from '@nestjs/common';
import { ClaimFeeSettingsService } from './claim-fee-settings.service';

/**
 * Global module for platform-wide claim fee defaults (AppSetting-backed).
 *
 * `@Global()` supaya ClaimFeeSettingsService bisa di-inject di mana saja
 * (quests, canton, admin) tanpa import eksplisit per modul.
 * PrismaService sudah tersedia global via PrismaModule.
 */
@Global()
@Module({
  providers: [ClaimFeeSettingsService],
  exports: [ClaimFeeSettingsService],
})
export class ClaimFeeSettingsModule {}
