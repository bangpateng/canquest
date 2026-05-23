import { Module } from '@nestjs/common';
import { TwitterApiService } from './twitter-api.service';
import { TwitterController } from './twitter.controller';

@Module({
  controllers: [TwitterController],
  providers: [TwitterApiService],
  exports: [TwitterApiService],
})
export class TwitterModule {}
