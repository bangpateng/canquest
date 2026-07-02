import { Module } from '@nestjs/common';
import { LedgerIndexerService } from './ledger-indexer.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { CantonModule } from '../canton/canton.module';

/**
 * LedgerIndexerModule — background service yang poll ledger events.
 *
 * Cara aktifkan (di .env):
 *   LEDGER_INDEXER_ENABLED=true
 *   LEDGER_INDEXER_PARTY_IDS=party1::abc123,party2::def456
 *   LEDGER_INDEXER_POLL_INTERVAL_MS=15000   (optional, default 15000)
 *   MODO_API_URL + MODO_API_KEY            (dipakai ModoApiService)
 *
 * Service ini implements OnModuleInit/OnModuleDestroy sehingga:
 *   - Mulai otomatis saat NestJS app start
 *   - Stop bersih saat app shutdown
 */
@Module({
  imports: [PrismaModule, ConfigModule, CantonModule],
  providers: [LedgerIndexerService],
  exports: [LedgerIndexerService],
})
export class LedgerIndexerModule {}
