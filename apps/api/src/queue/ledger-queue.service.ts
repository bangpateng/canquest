import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import Bull from 'bull';
type Queue = Bull.Queue;
import { QUEUE_LEDGER, JOB_SEND_CC_REWARD } from './queue.constants';
import type { SendCcRewardPayload } from './ledger-job.processor';

/**
 * LedgerQueueService — public API untuk enqueue jobs.
 *
 * Import service ini di controller/service lain,
 * gunakan method-nya untuk enqueue tanpa menyentuh Bull langsung.
 *
 * Contoh penggunaan di quests.controller.ts:
 *   await this.ledgerQueue.enqueueCcReward({ userId, username, ... });
 *
 * Job akan di-process oleh LedgerJobProcessor secara async.
 * HTTP response sudah dikirim ke user, worker jalan di background.
 */
@Injectable()
export class LedgerQueueService {
  private readonly logger = new Logger(LedgerQueueService.name);

  constructor(@InjectQueue(QUEUE_LEDGER) private readonly ledgerQueue: Queue) {}

  /** Enqueue pengiriman CC reward ke user (quest reward, admin distribute, dll). */
  async enqueueCcReward(payload: SendCcRewardPayload): Promise<string> {
    const job = await this.ledgerQueue.add(JOB_SEND_CC_REWARD, payload, {
      jobId: `cc-reward-${payload.userId}-${payload.referenceId ?? Date.now()}`,
      priority: 2,
    });
    this.logger.log(
      `Enqueued SendCcReward job ${String(job.id)} → @${payload.username} ${payload.amountCc} CC`,
    );
    return String(job.id);
  }
}
