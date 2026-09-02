import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { UploadsController } from './uploads.controller';
import { EcosystemMediaController } from './ecosystem-media.controller';

@Module({
  imports: [UsersModule],
  controllers: [UploadsController, EcosystemMediaController],
})
export class UploadsModule {}
