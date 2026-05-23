import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [UsersModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
