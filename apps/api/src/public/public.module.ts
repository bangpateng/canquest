import { Module } from '@nestjs/common';
import { QuestsModule } from '../quests/quests.module';
import { PublicController } from './public.controller';

@Module({
  imports: [QuestsModule],
  controllers: [PublicController],
})
export class PublicModule {}
