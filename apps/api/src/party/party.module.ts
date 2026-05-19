import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CantonModule } from '../canton/canton.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PartyController } from './party.controller';

@Module({
  imports: [UsersModule, AuthModule, CantonModule, ConfigModule],
  controllers: [PartyController],
})
export class PartyModule {}
