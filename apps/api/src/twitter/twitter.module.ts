import { Module } from '@nestjs/common';
import { TwitterApiService } from './twitter-api.service';
import { TwitterController } from './twitter.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [TwitterController],
  providers: [TwitterApiService],
  exports: [TwitterApiService],
})
export class TwitterModule {}
