import { Module } from '@nestjs/common';
import { ProfileAvatarService } from './profile-avatar.service';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [ReferralController],
  providers: [UsersService, ProfileAvatarService, ReferralService],
  exports: [UsersService, ProfileAvatarService, ReferralService],
})
export class UsersModule {}
