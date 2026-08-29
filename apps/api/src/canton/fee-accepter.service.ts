import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';

/**
 * FeeAccepterService — auto-accept TransferInstruction masuk ke party FEE.
 *
 * LATAR (temuan MainNet 2026-08-29, error "Contract group identifier
 * mismatch: expected ForOwner{owner=canquest-fee}, got ForOwner{owner=…}"):
 * dalam SATU exercise (WalletUserProxy_BatchTransfer), semua leg yang settle
 * DIRECT (receiver punya TransferPreapproval → fetchChecked preapproval)
 * harus se-grup — satu receiver-owner saja. Karena itu batch
 * [direct→external + direct→canquest-fee] SELALU ditolak DAML.
 *
 * SOLUSI: fee leg dibuat sebagai OFFER (preapproval canquest-fee dihapus
 * on-chain) → batch [direct→external + offer→canquest-fee] lolos (satu
 * grup direct saja) — simetris dengan pola internal [offer + direct] yang
 * sudah terbukti. Fee lalu berupa TransferInstruction PENDING ke party fee
 * → service ini yang men-accept-nya custodial (controller choice =
 * receiver = party fee, di-hosting participant kita).
 *
 * Tanpa accepter, offer fee hangus saat executeBefore (24j) lewat.
 * Poll default 20 detik → fee settle < 1 menit setelah transfer user.
 *
 * Idempoten + aman saat preapproval MASIH ada: direct transfer tidak
 * menghasilkan instruction → tidak ada yang di-accept (no-op).
 */
@Injectable()
export class FeeAccepterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeeAccepterService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** Party fee on-chain (resolved sekali, cache). */
  private feePartyOnChain: string | null = null;
  /** Retry tracking per cid — setelah 5x gagal beruntun, berhenti (log error). */
  private readonly failures = new Map<string, number>();
  private static readonly MAX_FAILURES = 5;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = Math.max(
      5,
      Number(this.config.get<string>('QUEST_FEE_ACCEPT_POLL_SECONDS') ?? 20),
    );
    // Fire-and-forget tick awal; interval berikutnya jitter kecil agar tidak
    // se-fase dengan poll lain (balance sync, reconciler).
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
    this.logger.log(`FeeAccepter aktif (poll ${seconds}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const feePartyRaw =
        this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
        this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
      if (!feePartyRaw) return; // party fee belum dikonfigurasi — diam saja

      if (!this.feePartyOnChain) {
        this.feePartyOnChain =
          await this.splice.resolveOnChainPartyId(feePartyRaw);
        if (!this.feePartyOnChain) return;
      }

      const offers = await this.ledger.queryPendingOffers(
        this.feePartyOnChain,
        'incoming',
      );
      // Fee platform = CC (Amulet). Offer token non-CC ke party fee tidak
      // ada alaminya saat ini — skip agar tidak salah accept.
      const instructions = offers.filter(
        (o) =>
          o.type === 'transfer_instruction' &&
          (o.instrumentId ?? 'Amulet').toLowerCase() === 'amulet',
      );
      if (instructions.length === 0) return;

      this.logger.log(
        `FeeAccepter: ${instructions.length} instruction fee pending → accept…`,
      );
      for (const ins of instructions) {
        if ((this.failures.get(ins.contractId) ?? 0) >= FeeAccepterService.MAX_FAILURES) {
          continue; // sudah menyerah untuk cid ini (log saat keputusan di bawah)
        }
        const res = await this.ledger.acceptTransferInstruction(
          ins.contractId,
          this.feePartyOnChain,
        );
        if (res.ok) {
          this.failures.delete(ins.contractId);
          this.logger.log(
            `Fee accepted: ${ins.amount} CC dari ${ins.sender.split('::')[0]} ` +
              `(${ins.description.slice(0, 60)}) updateId=${res.updateId?.slice(0, 16) ?? '?'}`,
          );
        } else {
          const n = (this.failures.get(ins.contractId) ?? 0) + 1;
          this.failures.set(ins.contractId, n);
          if (n >= FeeAccepterService.MAX_FAILURES) {
            this.logger.error(
              `Fee accept GAGAL ${n}x, berhenti mencoba cid=${ins.contractId.slice(0, 20)}… ` +
                `(${ins.amount} CC dari ${ins.sender.split('::')[0]}): ${res.error?.slice(0, 160)} — ` +
                `PERLU TINDAKAN MANUAL (offer hangus dalam 24j).`,
            );
          } else {
            this.logger.warn(
              `Fee accept gagal (${n}/${FeeAccepterService.MAX_FAILURES}) cid=${ins.contractId.slice(0, 20)}…: ${res.error?.slice(0, 120)}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`FeeAccepter tick error: ${String(err).slice(0, 160)}`);
    } finally {
      this.busy = false;
    }
  }
}
