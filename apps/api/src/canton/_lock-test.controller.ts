import { Controller, Post, Body } from '@nestjs/common';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * TEMPORARY test harness for CC lock/unlock cycle.
 * ⚠️ HAPUS file ini setelah uji selesai (lihat findLockedAmulets/lockCc/unlockCc
 *    di canton-ledger.service.ts untuk integrasi production).
 */
@Controller('_locktest')
export class LockTestController {
  constructor(private readonly ledger: CantonLedgerService) {}

  @Post('lock')
  lock(@Body() b: { owner: string; amount: number; seconds: number }) {
    return this.ledger.lockCc(b.owner, b.amount, b.seconds);
  }

  @Post('unlock')
  unlock(@Body() b: { owner: string; cid?: string }) {
    return this.ledger.unlockCc(b.owner, b.cid);
  }

  @Post('locked')
  locked(@Body() b: { owner: string }) {
    return this.ledger.findLockedAmulets(b.owner);
  }
}
