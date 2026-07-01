import { Module } from '@nestjs/common';
import { TwitterApiService } from './twitter-api.service';
import { TwitterCacheService } from './twitter-cache.service';
import { TwitterController } from './twitter.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [TwitterController],
  providers: [TwitterApiService, TwitterCacheService],
  exports: [TwitterApiService, TwitterCacheService],
})
export class TwitterModule {}
