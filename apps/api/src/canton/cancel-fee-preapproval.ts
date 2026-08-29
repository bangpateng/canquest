/**
 * OPS SCRIPT — hapus TransferPreapproval party fee (sekali jalan).
 *
 * Jalankan dari apps/api di VPS:
 *   npx ts-node src/canton/cancel-fee-preapproval.ts
 *
 * Latar: preapproval party fee membuat fee leg settle DIRECT →
 * batch [direct→external + direct→fee] ditolak DAML (ForOwner group
 * mismatch). Tanpa preapproval, fee leg jadi OFFER yang di-auto-accept
 * FeeAccepterService → batch [direct→external + offer→fee] lolos 1 tx.
 *
 * Restore (kalau perlu balik ke direct): buat ulang preapproval via
 * validator admin API (pola sama dgn onboarding user external).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ConfigService } from '@nestjs/config';
import { CantonLedgerService } from './canton-ledger.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const config = app.get(ConfigService);
    const ledger = app.get(CantonLedgerService);
    const feeParty =
      config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!feeParty) throw new Error('Fee party tidak dikonfigurasi');
    console.log(`[cancel-fee-preapproval] target = ${feeParty}`);
    const res = await ledger.cancelTransferPreapprovalViaLedger(feeParty);
    console.log('[cancel-fee-preapproval] result =', JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error('[cancel-fee-preapproval] ERROR:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}
void main();
