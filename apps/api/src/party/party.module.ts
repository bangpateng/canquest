import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CantonModule } from '../canton/canton.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WalletInviteCodeService } from './wallet-invite-code.service';
import { PartyWalletController } from './party-wallet.controller';
import { PartyPreapprovalController } from './party-preapproval.controller';
import { PartyTransferController } from './party-transfer.controller';
import { PartyOfferController } from './party-offer.controller';
import { PartyLockController } from './party-lock.controller';
import { PartySwapController } from './party-swap.controller';
import { PartyAccountController } from './party-account.controller';
import { ExternalWalletController } from './external-wallet.controller';
import { SigningRelayController } from './signing-relay.controller';

/**
 * Semua controller domain memakai prefix @Controller('party') — URL publik
 * tidak berubah. Pemecahan hanya organisasi file (dari satu controller
 * 3.3k baris menjadi 7 controller domain).
 */
@Module({
  imports: [UsersModule, AuthModule, CantonModule, ConfigModule],
  controllers: [
    PartyWalletController,
    PartyPreapprovalController,
    PartyTransferController,
    PartyOfferController,
    PartyLockController,
    PartySwapController,
    PartyAccountController,
    ExternalWalletController,
    SigningRelayController,
  ],
  providers: [WalletInviteCodeService],
  exports: [WalletInviteCodeService],
})
export class PartyModule {}
