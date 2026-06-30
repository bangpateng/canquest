import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/**
 * Modul realtime SSE.
 *
 * `@Global()` → RealtimeService bisa di-inject di service mana pun (UsersService,
 * CcInboundSyncService, dll) tanpa tiap modul harus import RealtimeModule
 * eksplisit. Ini mengikuti pola PrismaModule yang juga @Global.
 *
 * Import AuthModule untuk dapat JwtService (verify token SSE ephemeral di
 * RealtimeController). AuthModule sudah export JwtModule.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
