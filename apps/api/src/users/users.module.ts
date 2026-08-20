import { Module } from '@nestjs/common';
import { WalletRequiredGuard } from '../common/wallet-required.guard';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import { UsersService } from './users.service';
import { UsersPreferencesController } from './users-preferences.controller';

@Module({
  controllers: [
    ReferralController,
    PointsController,
    UsersPreferencesController,
  ],
  providers: [
    UsersService,
    PointsService,
    ReferralService,
    WalletRequiredGuard,
  ],
  exports: [UsersService, PointsService, ReferralService, WalletRequiredGuard],
})
export class UsersModule {}
