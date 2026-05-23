import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QuestsController } from './quests.controller';
import { QuestsService } from './quests.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CantonModule } from '../canton/canton.module';
import { QueueModule } from '../queue/queue.module';
import { TwitterModule } from '../twitter/twitter.module';

@Module({
  imports: [AuthModule, UsersModule, CantonModule, ConfigModule, QueueModule, TwitterModule],
  controllers: [QuestsController],
  providers: [QuestsService],
  exports: [QuestsService],
})
export class QuestsModule {}
