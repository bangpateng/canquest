import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';
import { FeaturedAppActivityService } from './featured-app-activity.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';
import { CcBalanceService } from './cc-balance.service';
import { TransactionDetailService } from './transaction-detail.service';
import { QuestLedgerService } from './quest-ledger.service';
import { SpliceWalletManagerService } from './splice-wallet-manager.service';

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
  imports: [PrismaModule, ConfigModule, UsersModule],
  providers: [
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
    CcBalanceService,
    TransactionDetailService,
    QuestLedgerService,
    SpliceWalletManagerService,
  ],
  exports: [
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
    CcBalanceService,
    TransactionDetailService,
    QuestLedgerService,
    SpliceWalletManagerService,
  ],
})
export class CantonModule {}
