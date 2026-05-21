import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';
import { FeaturedAppActivityService } from './featured-app-activity.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';

/**
 * CantonModule wires together:
 *  - CantonLedgerService   : Canton JSON Ledger API v2 (port 7575)
 *  - SpliceValidatorService: Splice Validator App API (port 5003 / 8080)
 *  - FeaturedAppActivityService: App reward markers per Canton Module 4
 *
 * Architecture reference:
 *   https://docs.canton.network/appdev/modules/m4-app-architecture
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
  ],
  exports: [
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
  ],
})
export class CantonModule {}
