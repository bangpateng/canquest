import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import Bull from 'bull';
type Queue = Bull.Queue;
import {
  QUEUE_LEDGER,
  QUEUE_SPIN,
  JOB_SEND_CC_REWARD,
  JOB_DISTRIBUTE_REWARD,
  JOB_ACCEPT_OFFER,
  JOB_PROCESS_SPIN,
} from './queue.constants';
import type {
  SendCcRewardPayload,
  DistributeRewardPayload,
  AcceptOfferPayload,
} from './ledger-job.processor';
import type { ProcessSpinPayload } from './spin-job.processor';

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

  constructor(
    @InjectQueue(QUEUE_LEDGER) private readonly ledgerQueue: Queue,
    @InjectQueue(QUEUE_SPIN) private readonly spinQueue: Queue,
  ) {}

  /** Enqueue pengiriman CC reward ke user (quest reward, admin distribute, dll). */
  async enqueueCcReward(payload: SendCcRewardPayload): Promise<string> {
    const job = await this.ledgerQueue.add(JOB_SEND_CC_REWARD, payload, {
      jobId: `cc-reward-${payload.userId}-${payload.referenceId ?? Date.now()}`,
      priority: 2,
    });
    this.logger.log(`Enqueued SendCcReward job ${String(job.id)} → @${payload.username} ${payload.amountCc} CC`);
    return String(job.id);
  }

  /** Enqueue distribusi reward dari admin draw-winners. */
  async enqueueDistributeReward(payload: DistributeRewardPayload): Promise<string> {
    const job = await this.ledgerQueue.add(JOB_DISTRIBUTE_REWARD, payload, {
      jobId: `distribute-${payload.drawId}`,
      priority: 3,
    });
    this.logger.log(`Enqueued DistributeReward job ${String(job.id)} draw=${payload.drawId}`);
    return String(job.id);
  }

  /** Enqueue accept transfer offer (fallback jika immediate accept gagal). */
  async enqueueAcceptOffer(payload: AcceptOfferPayload): Promise<string> {
    const job = await this.ledgerQueue.add(JOB_ACCEPT_OFFER, payload, {
      jobId: `accept-${payload.offerContractId.slice(0, 16)}`,
      priority: 1, // high priority
    });
    this.logger.log(`Enqueued AcceptOffer job ${String(job.id)} offer=${payload.offerContractId.slice(0, 16)}…`);
    return String(job.id);
  }

  /** Enqueue processing spin result (CC delivery). */
  async enqueueSpinResult(payload: ProcessSpinPayload): Promise<string> {
    const job = await this.spinQueue.add(JOB_PROCESS_SPIN, payload, {
      jobId: `spin-${payload.spinResultId}`,
      priority: 2,
    });
    this.logger.log(`Enqueued ProcessSpin job ${String(job.id)} result=${payload.spinResultId}`);
    return String(job.id);
  }

  /** Ambil status queue untuk health check / monitoring. */
  async getQueueStats() {
    const [ledgerCounts, spinCounts] = await Promise.all([
      this.ledgerQueue.getJobCounts(),
      this.spinQueue.getJobCounts(),
    ]);
    return {
      ledger: ledgerCounts,
      spin: spinCounts,
    };
  }
}
