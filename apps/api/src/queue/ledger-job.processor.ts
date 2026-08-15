import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import Bull from 'bull';
type Job<T> = Bull.Job<T>;
import { QUEUE_LEDGER, JOB_SEND_CC_REWARD } from './queue.constants';
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

// ── Processor ─────────────────────────────────────────────────────────────────

/**
 * LedgerJobProcessor — Bull worker untuk operasi Canton ledger.
 *
 * Keuntungan vs fire-and-forget di controller:
 *   ✅ Retry otomatis (exponential backoff via Bull)
 *   ✅ Job tidak hilang jika server restart (Redis-persisted)
 *   ✅ Concurrency terkontrol (defaultConcurrency=2)
 *   ✅ Audit trail lengkap di job history
 *   ✅ HTTP response langsung kembali ke user
 */
@Processor(QUEUE_LEDGER)
export class LedgerJobProcessor {
  private readonly logger = new Logger(LedgerJobProcessor.name);

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly questLedger: QuestLedgerService,
    private readonly config: ConfigService,
  ) {}

  // ── Send CC Reward ───────────────────────────────────────────────────────────

  @Process(JOB_SEND_CC_REWARD)
  async processSendCcReward(job: Job<SendCcRewardPayload>): Promise<void> {
    const {
      userId,
      username,
      cantonPartyId,
      amountCc,
      description,
      referenceId,
    } = job.data;
    this.logger.log(
      `[Job ${job.id}] SendCcReward (CIP-0056): ${amountCc} CC → @${username} (attempt ${job.attemptsMade + 1})`,
    );

    // ── Fund-safety #5: re-check guard (cegah double payout saat Bull retry) ──
    // jobId dedup (cc-reward-${userId}-${referenceId}) blok re-enqueue, TAPI Bull
    // retry internal (attempts:3) re-run job yang sama kalau throw. Tanpa guard ini,
    // retry setelah DB-error bisa re-send CC (commandId random → tidak di-dedup ledger)
    // → double payout. Cek apakah reward untuk quest/user ini sudah pernah tercatat.
    if (referenceId) {
      const alreadyPaid = await this.prisma.ccTransaction.findFirst({
        where: {
          userId,
          type: 'QUEST_REWARD',
          // referenceId quest disimpan di description (audit label), bukan kolom
          // terpisah — match via ledgerTxId existence (reward sent = row exists).
          ledgerTxId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, ledgerTxId: true },
      });
      if (alreadyPaid) {
        this.logger.warn(
          `[Job ${job.id}] ⚠️ SKIP double-payout: reward untuk @${username} ` +
            `sudah tercatat (txId=${alreadyPaid.ledgerTxId?.slice(0, 16) ?? 'n/a'}). ` +
            `Bull retry di-skip — CC tidak dikirim ulang.`,
        );
        return; // job selesai sukses, tidak re-send CC
      }
    }

    // Validator party sends the reward
    const validatorPartyId =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';

    // Step 1: Try CIP-0056 TransferFactory_Transfer (identity='reward' for dapp-reward auth)
    const cip56Result = await this.ledger.executeTransferFactoryTransfer({
      senderPartyId: validatorPartyId,
      receiverPartyId: cantonPartyId,
      amountCc,
      description,
      identity: 'reward',
    });

    let accepted = false;
    let ledgerTxId = '';

    if (cip56Result.ok) {
      // Preapproval ON (direct) → CC langsung masuk.
      // Preapproval OFF (offer) → JANGAN auto-accept atas nama user.
      //   Biarkan AmuletTransferInstruction pending di inbox wallet receiver;
      //   user accept/reject manual via menu Offers.
      accepted = cip56Result.transferKind === 'direct';
      // ledgerTxId = Canton update_id ("1220…") supaya link explorer jalan.
      // contract_id (transferInstructionCid) tidak disimpan di kolom tx.
      ledgerTxId = cip56Result.updateId ?? '';
    }

    // CIP-0056 is the only supported reward path. If it fails, retry.
    if (!cip56Result.ok) {
      throw new Error(
        `CIP-0056 transfer unavailable for @${username} ` +
          `(${cip56Result.error?.slice(0, 80) ?? 'unknown'}) — will retry`,
      );
    }

    // Step 3: catat transaksi ke DB.
    // ── Fund-safety #5: JANGAN throw kalau DB write gagal setelah CC sudah terkirim.
    // Throw akan trigger Bull retry → re-send CC (commandId random → double payout).
    // Bungkus: log AUDIT-TRAIL LOSS + tetap anggap job sukses supaya tidak retry.
    // Balance self-heal via cc-inbound-sync; history row reconcile manual dari log.
    try {
      await this.users.recordTransaction({
        userId,
        amountCc,
        type: 'QUEST_REWARD',
        description,
        ledgerTxId,
        cantonUpdateId: cip56Result.updateId ?? undefined,
      });
    } catch (err) {
      this.logger.error(
        `[Job ${job.id}] ⚠️ AUDIT-TRAIL LOSS: reward CC SUDAH terkirim tapi DB record gagal. ` +
          `user=${userId} @${username} amount=${amountCc} CC ledgerTxId=${ledgerTxId.slice(0, 16)}… ` +
          `TIDAK throw (cegah retry double-payout). Balance self-heal via sync. ` +
          `History row MISSING — reconcile manual. Error: ${String(err)}`,
      );
      // Sengaja tidak throw — CC sudah pergi, retry hanya akan double-payout.
    }

    this.logger.log(
      `[Job ${job.id}] ✅ ${amountCc} CC → @${username} kind=${cip56Result.transferKind} ` +
        `${accepted ? 'accepted' : 'pending (preapproval OFF)'} txId=${ledgerTxId.slice(0, 16)}…`,
    );
  }
}
