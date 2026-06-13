import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import Bull from 'bull';
type Job<T> = Bull.Job<T>;
import {
  QUEUE_LEDGER,
  JOB_SEND_CC_REWARD,
  JOB_DISTRIBUTE_REWARD,
  JOB_ACCEPT_OFFER,
} from './queue.constants';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

// ── Job payload types ──────────────────────────────────────────────────────────

export interface SendCcRewardPayload {
  userId: string;
  username: string;
  cantonPartyId: string;
  amountCc: number;
  description: string;
  /** questId untuk label audit */
  referenceId?: string;
}

export interface DistributeRewardPayload {
  drawId: string;
  questId: string;
  userId: string;
  username: string | null;
  cantonPartyId: string | null;
  amountCc: number;
}

export interface AcceptOfferPayload {
  offerContractId: string;
  /** Splice username — digunakan sebagai JWT sub untuk acceptOfferViaWallet */
  username: string;
  /** Human label untuk log */
  label?: string;
}

// ── Processor ─────────────────────────────────────────────────────────────────

/**
 * LedgerJobProcessor — BullMQ worker untuk semua operasi Canton ledger.
 *
 * Keuntungan vs fire-and-forget di controller:
 *   ✅ Retry otomatis (exponential backoff via BullMQ)
 *   ✅ Job tidak hilang jika server restart (Redis-persisted)
 *   ✅ Concurrency terkontrol (defaultConcurrency=2)
 *   ✅ Audit trail lengkap di job history
 *   ✅ HTTP response langsung kembali ke user
 */
@Processor(QUEUE_LEDGER)
export class LedgerJobProcessor {
  private readonly logger = new Logger(LedgerJobProcessor.name);

  constructor(
    private readonly splice: SpliceValidatorService,
    private readonly ledger: CantonLedgerService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly questLedger: QuestLedgerService,
    private readonly config: ConfigService,
  ) {}

  // ── Send CC Reward ───────────────────────────────────────────────────────────

  @Process(JOB_SEND_CC_REWARD)
  async processSendCcReward(job: Job<SendCcRewardPayload>): Promise<void> {
    const { userId, username, cantonPartyId, amountCc, description, referenceId } = job.data;
    this.logger.log(
      `[Job ${job.id}] SendCcReward (CIP-0056): ${amountCc} CC → @${username} (attempt ${job.attemptsMade + 1})`,
    );

    // Validator party sends the reward
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';

    // Step 1: CIP-0056 TransferFactory_Transfer
    const cip56Result = await this.ledger.executeTransferFactoryTransfer({
      senderPartyId: validatorPartyId,
      receiverPartyId: cantonPartyId,
      amountCc,
      description,
    });

    if (!cip56Result.ok) {
      throw new Error(
        `CIP-0056 transfer failed for @${username}: ${cip56Result.error ?? 'unknown'} — will retry`,
      );
    }

    // Step 2: If TransferInstruction was created (no preapproval), auto-accept
    let accepted = cip56Result.transferKind === 'direct';
    if (!accepted && cip56Result.transferInstructionCid) {
      const acceptResult = await this.ledger.acceptTransferInstruction(
        cip56Result.transferInstructionCid,
        cantonPartyId,
      );
      accepted = acceptResult.ok;
      if (!accepted) {
        this.logger.warn(
          `[Job ${job.id}] TransferInstruction created but auto-accept failed: ${acceptResult.error ?? 'unknown'}`,
        );
      }
    }

    const ledgerTxId = cip56Result.updateId ?? cip56Result.transferInstructionCid ?? '';

    // Step 3: catat transaksi ke DB
    await this.users.recordTransaction({
      userId,
      amountCc,
      type: 'QUEST_REWARD',
      description,
      ledgerTxId,
    });

    if (referenceId && this.questLedger.isConfigured()) {
      const completion = await this.prisma.questCompletion.findUnique({
        where: { userId_questId: { userId, questId: referenceId } },
        select: { ledgerRewardId: true },
      });
      if (completion?.ledgerRewardId) {
        const marked = await this.questLedger.markRewardClaimed({
          rewardContractId: completion.ledgerRewardId,
          payoutTxId: ledgerTxId,
        });
        if (!marked.ok) {
          this.logger.warn(
            `[Job ${job.id}] QuestReward mark claimed: ${marked.errors.join(' | ')}`,
          );
        }
      }
    }

    this.logger.log(
      `[Job ${job.id}] ✅ ${amountCc} CC → @${username} kind=${cip56Result.transferKind} ` +
      `accepted=${String(accepted)} txId=${ledgerTxId.slice(0, 16)}…`,
    );
  }

  // ── Distribute Quest Reward (Admin) ──────────────────────────────────────────

  @Process(JOB_DISTRIBUTE_REWARD)
  async processDistributeReward(job: Job<DistributeRewardPayload>): Promise<void> {
    const { drawId, questId, userId, username, cantonPartyId, amountCc } = job.data;
    this.logger.log(`[Job ${job.id}] DistributeReward (CIP-0056): draw=${drawId} ${amountCc} CC → @${username ?? 'unknown'}`);

    let ledgerTxId: string | null = null;
    let ccSent = false;

    if (amountCc > 0 && cantonPartyId && username) {
      const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';

      // CIP-0056: TransferFactory_Transfer instead of deprecated createTransferOffer
      const cip56Result = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId: validatorPartyId,
        receiverPartyId: cantonPartyId,
        amountCc,
        description: `Quest winner reward: ${questId}`,
      });

      if (!cip56Result.ok) {
        throw new Error(
          `CIP-0056 transfer failed for draw=${drawId}: ${cip56Result.error ?? 'unknown'} — will retry`,
        );
      }

      // Auto-accept if TransferInstruction (no preapproval)
      let accepted = cip56Result.transferKind === 'direct';
      if (!accepted && cip56Result.transferInstructionCid) {
        const acceptResult = await this.ledger.acceptTransferInstruction(
          cip56Result.transferInstructionCid,
          cantonPartyId,
        );
        accepted = acceptResult.ok;
        if (!accepted) {
          throw new Error(
            `TransferInstruction accept failed for draw=${drawId}: ${acceptResult.error ?? 'unknown'} — will retry`,
          );
        }
      }

      ccSent = true;
      ledgerTxId = cip56Result.updateId ?? cip56Result.transferInstructionCid ?? null;

      await this.users.recordTransaction({
        userId,
        amountCc,
        type: 'QUEST_REWARD',
        description: `Quest winner reward: ${questId}`,
        ledgerTxId: ledgerTxId ?? undefined,
      });
    }

    // Update WinnerDraw record
    await this.prisma.winnerDraw.update({
      where: { id: drawId },
      data: {
        distributed: true,
        ledgerTxId: ledgerTxId ?? undefined,
        distributedAt: new Date(),
      },
    });

    this.logger.log(`[Job ${job.id}] ✅ draw=${drawId} distributed ccSent=${String(ccSent)}`);
  }

  // ── Accept Transfer Offer ────────────────────────────────────────────────────

  @Process(JOB_ACCEPT_OFFER)
  async processAcceptOffer(job: Job<AcceptOfferPayload>): Promise<void> {
    const { offerContractId, username, label } = job.data;
    this.logger.log(`[Job ${job.id}] AcceptOffer: ${offerContractId.slice(0, 16)}… as @${username} ${label ?? ''}`);

    const ok = await this.splice.acceptOfferViaWallet(offerContractId, username);
    if (!ok) {
      throw new Error(`acceptOfferViaWallet failed for @${username} — will retry`);
    }

    this.logger.log(`[Job ${job.id}] ✅ Offer accepted for @${username}`);
  }
}
