import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_LEDGER, QUEUE_SPIN } from './queue.constants';
import { LedgerJobProcessor } from './ledger-job.processor';
import { SpinJobProcessor } from './spin-job.processor';
import { LedgerQueueService } from './ledger-queue.service';
import { CantonModule } from '../canton/canton.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * QueueModule — async job processing via BullMQ + Redis.
 *
 * Kenapa queue?
 *   - Canton ledger calls bisa 1–10 detik → tidak boleh blokir HTTP response
 *   - Retry otomatis jika ledger timeout/error (BullMQ built-in retry)
 *   - Audit trail setiap job (Bull dashboard, logs)
 *   - Concurrency control — ledger tidak dibombardir concurrent requests
 *
 * Redis connection:
 *   REDIS_HOST (default: 127.0.0.1)
 *   REDIS_PORT (default: 6379)
 *   REDIS_PASSWORD (optional)
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
          port: Number(config.get<string>('REDIS_PORT') ?? '6379'),
          password: config.get<string>('REDIS_PASSWORD') ?? undefined,
          // Reconnect otomatis jika Redis putus
          retryStrategy: (times: number) => Math.min(times * 200, 5_000),
        },
        defaultJobOptions: {
          attempts: 3,                     // 3x retry otomatis
          backoff: { type: 'exponential', delay: 1_000 }, // 1s, 2s, 4s
          removeOnComplete: 100,           // simpan 100 completed jobs
          removeOnFail: 500,               // simpan 500 failed jobs
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_LEDGER },
      { name: QUEUE_SPIN },
    ),
    CantonModule,
    UsersModule,
    PrismaModule,
  ],
  providers: [LedgerJobProcessor, SpinJobProcessor, LedgerQueueService],
  exports: [BullModule, LedgerQueueService],
})
export class QueueModule {}
