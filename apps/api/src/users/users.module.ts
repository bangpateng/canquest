import { Module } from '@nestjs/common';
import { ProfileAvatarService } from './profile-avatar.service';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, ProfileAvatarService],
  exports: [UsersService, ProfileAvatarService],
})
export class UsersModule {}
