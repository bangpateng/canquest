import { Module } from '@nestjs/common';
import { WalletRequiredGuard } from '../common/wallet-required.guard';
import { ProfileAvatarService } from './profile-avatar.service';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [ReferralController],
  providers: [UsersService, ProfileAvatarService, ReferralService, WalletRequiredGuard],
  exports: [UsersService, ProfileAvatarService, ReferralService, WalletRequiredGuard],
})
export class UsersModule {}
