import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bull from 'bull';
type Job<T> = Bull.Job<T>;
import { QUEUE_SPIN, JOB_PROCESS_SPIN } from './queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';

export interface ProcessSpinPayload {
  spinResultId: string;
  userId: string;
  username: string | null;
  cantonPartyId: string | null;
  /** Tipe reward: 'cc' | 'points' | 'invite_code' | 'none' */
  rewardType: string;
  /** CC amount jika rewardType === 'cc' */
  rewardCc?: number;
  /** Points amount jika rewardType === 'points' */
  rewardPoints?: number;
}

/**
 * SpinJobProcessor — handle async delivery setelah hasil spin ditentukan.
 *
 * Flow:
 *   1. Spin controller → DB (hasil spin disimpan) → enqueue job
 *   2. Worker: jika reward = CC → createTransferOffer (sender = canquest-reward-user) + accept
 *   3. Worker: update SpinResult status = DELIVERED
 */
@Processor(QUEUE_SPIN)
export class SpinJobProcessor {
  private readonly logger = new Logger(SpinJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Process(JOB_PROCESS_SPIN)
  async processSpinResult(job: Job<ProcessSpinPayload>): Promise<void> {
    const { spinResultId, userId, username, cantonPartyId, rewardType, rewardCc } = job.data;

    this.logger.log(
      `[Job ${job.id}] ProcessSpin: result=${spinResultId} type=${rewardType} ${rewardCc ? rewardCc + ' CC' : ''}`,
    );

    if (rewardType === 'cc' && rewardCc && rewardCc > 0) {
      if (!cantonPartyId || !username) {
        this.logger.warn(`[Job ${job.id}] CC reward tapi user tidak punya wallet — skip`);
        await this.markDelivered(spinResultId, false);
        return;
      }

      const rewardResult = await this.splice.sendReward({
        receiverPartyId: cantonPartyId,
        amountCc: rewardCc,
        description: `Spin reward`,
      });
      if (!rewardResult.ok) {
        throw new Error(`spin reward failed for ${spinResultId}: ${rewardResult.error ?? 'unknown'} — will retry`);
      }
      const offerContractId = rewardResult.rewardTxId ?? `reward-${Date.now()}`;

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'SPIN_REWARD',
        description: `Spin reward: ${rewardCc} CC`,
        ledgerTxId: offerContractId,
        status: rewardResult.pending ? 'PENDING' : 'COMPLETED',
        transferInstructionCid: rewardResult.transferInstructionCid ?? null,
      });

      await this.markDelivered(spinResultId, true, offerContractId);
      this.logger.log(
        `[Job ${job.id}] ✅ Spin CC reward ${rewardResult.pending ? 'PENDING (user accepts in wallet)' : 'delivered direct'}: ${rewardCc} CC → @${username}`,
      );
    } else {
      // Non-CC reward (points already credited by SpinService synchronously)
      await this.markDelivered(spinResultId, true);
      this.logger.log(`[Job ${job.id}] ✅ Spin non-CC reward acknowledged: ${rewardType}`);
    }
  }

  private async markDelivered(
    spinResultId: string,
    delivered: boolean,
    ledgerTxId?: string,
  ) {
    await this.prisma.spinResult.update({
      where: { id: spinResultId },
      data: {
        delivered,
        ledgerTxId: ledgerTxId ?? null,
        deliveredAt: delivered ? new Date() : null,
      },
    });
  }
}