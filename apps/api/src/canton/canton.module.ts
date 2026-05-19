import { Module } from '@nestjs/common';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';

@Module({
  providers: [CantonLedgerService, SpliceValidatorService],
  exports: [CantonLedgerService, SpliceValidatorService],
})
export class CantonModule {}
