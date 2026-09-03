import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { KeycloakTokenService } from '../auth/keycloak-token.service';
import { KeycloakAdminService } from '../auth/keycloak-admin.service';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';
import { FeaturedAppActivityService } from './featured-app-activity.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';
import { CantonPriceService } from './canton-price.service';
import { TransactionDetailService } from './transaction-detail.service';
import { QuestLedgerService } from './quest-ledger.service';
import { LockEligibilityService } from './lock-eligibility.service';
import { OfferReconcilerService } from './offer-reconciler.service';
import { FeeAccepterService } from './fee-accepter.service';
import { CantonUpdatesService } from './canton-updates.service';
import { BalanceEventHandlerService } from './balance-event-handler.service';
import { TokenInstrumentHelper } from './token-instrument.helper';
import { ProxyCacheService } from './proxy-cache.service';
import { CantonWalletSdkService } from './wallet-sdk.service';
import { ExternalWalletService } from './external-wallet.service';
import { SigningRelayService } from './signing-relay.service';
import { ClaimOfferService } from './v30/claim-offer.service';
import { LockProposalService } from './v30/lock-proposal.service';
import { V30JobsService } from './v30/v30-jobs.service';

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
  controllers: [],
  providers: [
    KeycloakTokenService,
    KeycloakAdminService,
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
    CantonPriceService,
    TransactionDetailService,
    QuestLedgerService,
    LockEligibilityService,
    OfferReconcilerService,
    FeeAccepterService,
    CantonUpdatesService,
    BalanceEventHandlerService,
    TokenInstrumentHelper,
    ProxyCacheService,
    CantonWalletSdkService,
    ExternalWalletService,
    SigningRelayService,
    // ── v30 (canquest-claim + canquest-lock) ──
    ClaimOfferService,
    LockProposalService,
    V30JobsService,
  ],
  exports: [
    CantonLedgerService,
    SpliceValidatorService,
    FeaturedAppActivityService,
    CcInboundSyncService,
    CantonPriceService,
    TransactionDetailService,
    QuestLedgerService,
    LockEligibilityService,
    OfferReconcilerService,
    CantonUpdatesService,
    BalanceEventHandlerService,
    TokenInstrumentHelper,
    ProxyCacheService,
    ExternalWalletService,
    SigningRelayService,
    ClaimOfferService,
    LockProposalService,
  ],
})
export class CantonModule {}
