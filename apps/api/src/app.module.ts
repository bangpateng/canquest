import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerBehindProxyGuard } from './common/throttler-behind-proxy.guard';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CantonModule } from './canton/canton.module';
import { CantexModule } from './cantex/cantex.module';
import { PartyModule } from './party/party.module';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { QuestsModule } from './quests/quests.module';
import { AdminModule } from './admin/admin.module';
import { LedgerIndexerModule } from './ledger-indexer/ledger-indexer.module';
import { PublicModule } from './public/public.module';
import { EarnModule } from './earn/earn.module';
import { UploadsModule } from './uploads/uploads.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { TwitterModule } from './twitter/twitter.module';
import { throttlerConfig } from './common/throttler.config';
import { MaintenanceModule } from './common/maintenance.module';
import { MaintenanceGuard } from './common/maintenance.guard';
import { RealtimeModule } from './realtime/realtime.module';

/** Load API env from `apps/api/.env` even when npm workspaces run Nest with cwd at repo root. */
const resolveApiEnvPaths = (): string[] => [
  resolve(process.cwd(), 'apps', 'api', '.env'),
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '..', '..', '.env'),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveApiEnvPaths(),
    }),
    // ── Global rate limiting ────────────────────────────────────
    ThrottlerModule.forRoot(throttlerConfig),
    // ── Core modules ─────────────────────────────────────────────
    PrismaModule,
    SupabaseModule, // @Global: SupabaseService (service_role client) untuk Auth
    AuthModule,
    CantonModule,
    CantexModule, // @Global: CantexClient (DEX swap — Phase 1: read-only pools/quote)
    PartyModule,
    QuestsModule,
    EarnModule,
    AdminModule,
    // ── New modules ─────────────────────────────────────────────
    QueueModule,
    LedgerIndexerModule,
    PublicModule,
    UploadsModule,
    StorageModule,
    TwitterModule,
    // ── Global maintenance mode (live toggle via AppSetting) ─────
    MaintenanceModule,
    // ── Realtime SSE push (@Global, supaya RealtimeService bisa di-inject
    //    di service mana pun untuk emit event) ──────────────────────
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    // Apply ThrottlerGuard globally — semua endpoint dilindungi rate limit
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    // Maintenance guard global — menolak semua request non-exempt saat ON.
    // Berjalan setelah Throttler. Admin/health/status-maintenance di-exempt.
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
})
export class AppModule {}
