import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerBehindProxyGuard } from './common/throttler-behind-proxy.guard';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CantonModule } from './canton/canton.module';
import { PartyModule } from './party/party.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestsModule } from './quests/quests.module';
import { AdminModule } from './admin/admin.module';
import { SpinModule } from './spin/spin.module';
import { LedgerIndexerModule } from './ledger-indexer/ledger-indexer.module';
import { PublicModule } from './public/public.module';
import { EarnModule } from './earn/earn.module';
import { UploadsModule } from './uploads/uploads.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { TwitterModule } from './twitter/twitter.module';
import { throttlerConfig } from './common/throttler.config';

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
    AuthModule,
    CantonModule,
    PartyModule,
    QuestsModule,
    EarnModule,
    AdminModule,
    // ── New modules ─────────────────────────────────────────────
    QueueModule,
    SpinModule,
    LedgerIndexerModule,
    PublicModule,
    UploadsModule,
    StorageModule,
    TwitterModule,
  ],
    controllers: [AppController],
  providers: [
    // Apply ThrottlerGuard globally — semua endpoint dilindungi rate limit
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule {}


