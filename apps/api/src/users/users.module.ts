import { Module } from '@nestjs/common';
import { WalletRequiredGuard } from '../common/wallet-required.guard';
import { ProfileAvatarService } from './profile-avatar.service';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { PointsService } from './points.service';
import { UsersService } from './users.service';

@Module({
  controllers: [ReferralController],
  providers: [
    UsersService,
    PointsService,
    ProfileAvatarService,
    ReferralService,
    WalletRequiredGuard,
  ],
  exports: [
    UsersService,
    PointsService,
    ProfileAvatarService,
    ReferralService,
    WalletRequiredGuard,
  ],
})
export class UsersModule {}
