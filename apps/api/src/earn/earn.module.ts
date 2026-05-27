import { Module } from '@nestjs/common';
import { QuestsModule } from '../quests/quests.module';
import { EarnPublicController } from './earn-public.controller';

@Module({
  imports: [QuestsModule],
  controllers: [EarnPublicController],
})
export class EarnModule {}

