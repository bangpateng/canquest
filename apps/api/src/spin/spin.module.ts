import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SpinController } from './spin.controller';
import { SpinService } from './spin.service';
import { SpinAdminController } from './spin-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { QueueModule } from '../queue/queue.module';
import { CantonModule } from '../canton/canton.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, QueueModule, ConfigModule, CantonModule],
  controllers: [SpinController, SpinAdminController],
  providers: [SpinService],
  exports: [SpinService],
})
export class SpinModule {}
