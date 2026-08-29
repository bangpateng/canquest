/**
 * OPS SCRIPT — buat ulang TransferPreapproval party fee (sekali jalan).
 *
 * Jalankan dari apps/api di VPS:
 *   npx ts-node src/canton/restore-fee-preapproval.ts
 *
 * Dengan per-leg registry context (fix ForOwner mismatch), preapproval party
 * fee membuat leg fee settle DIRECT di transaksi user yang sama — benar-benar
 * 1 tx tanpa accept. FeeAccepterService tetap jalan sebagai safety net
 * (otomatis no-op saat tidak ada instruction masuk).
 *
 * Hapus lagi: npx ts-node src/canton/cancel-fee-preapproval.ts
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
    console.log(`[restore-fee-preapproval] target = ${feeParty}`);
    const res = await ledger.createTransferPreapprovalViaLedger(feeParty);
    console.log('[restore-fee-preapproval] result =', JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error('[restore-fee-preapproval] ERROR:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}
void main();
