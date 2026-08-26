/**
 * Wallet onboarding: akses, OTP, alokasi party Canton.
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import { AllocateWalletDto } from './dto/allocate-wallet.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../auth/auth.service';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { ConfigService } from '@nestjs/config';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { ResendEmailService } from '../auth/resend-email.service';
import { SendWalletOtpDto } from './dto/send-wallet-otp.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
import { VerifyWalletOtpDto } from './dto/verify-wallet-otp.dto';
import { WalletInviteCodeService } from './wallet-invite-code.service';
import { ExternalWalletService } from '../canton/external-wallet.service';
import { hasRealWallet } from '../common/wallet-policy';
import {
  normalizeCantonPartyId,
  normalizeWalletUsername,
  participantSuffixFromParty,
  participantSuffixesMatch,
} from '../common/canton-party-id';
import type { AuthedReq } from './party-shared';

/** Wallet onboarding: akses, OTP, alokasi party Canton. Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyWalletController {
  private readonly logger = new Logger(PartyWalletController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly config: ConfigService,
    private readonly walletInvites: WalletInviteCodeService,
    private readonly questLedger: QuestLedgerService,
    private readonly externalWallet: ExternalWalletService,
    private readonly auth: AuthService,
    private readonly resend: ResendEmailService,
  ) {}

  private assertPartyOnValidatorParticipant(partyId: string): void {
    if (partyId.startsWith('canquest:')) return;
    const anchor =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID')?.trim();
    if (!anchor || !partyId.includes('::')) return;
    if (participantSuffixesMatch(partyId, anchor)) return;

    const expected = participantSuffixFromParty(anchor);
    const got = participantSuffixFromParty(partyId);
    this.logger.error(
      `Party participant mismatch: got …${got?.slice(-16) ?? '?'} expected …${expected?.slice(-16) ?? '?'}`,
    );
    throw new BadRequestException(
      'Wallet was created on the wrong Canton participant (suffix after :: does not match your validator). ' +
        'Both tunnels must target the same validator stack: ' +
        '7575 → participant container, 8080 → nginx (wallet.localhost). ' +
        'Do not mix networks (DevNet vs TestNet). Re-run the tunnel script with correct Docker IPs, then create a new wallet.',
    );
  }

  @Get('wallet-access')
  @SkipThrottle()
  async walletAccessStatus(@Req() req: AuthedReq) {
    const hasRedeemedInvite = await this.walletInvites.userHasRedeemedInvite(
      req.user.userId,
    );
    return {
      requiresInviteCode: true,
      hasRedeemedInvite,
      // M2: frontend memakai ini untuk memilih jalur onboarding —
      // true = key ceremony (non-custodial), false = jalur custodial lama.
      externalWalletEnabled: this.externalWallet.isEnabled,
    };
  }

  @Post('wallet/otp/send')
  async sendWalletOtp(
    @Req() req: AuthedReq,
    @Body() body: SendWalletOtpDto,
  ): Promise<{
    message: string;
    expiresAt: string;
    devOtp?: string;
  }> {
    const username = normalizeWalletUsername(body.username) ?? '';
    if (username.length < 3) {
      throw new BadRequestException('Username must be at least 3 characters.');
    }

    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found');
    if (hasRealWallet(user.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const taken = await this.users.findByUsernameInsensitive(username);
    if (taken && taken.id !== req.user.userId) {
      throw new ConflictException('Party ID Already Taken');
    }

    // Pre-flight invite check — reserve slot (idempotent kalau user sudah redeem).
    // Tidak redeem di sini; redeem di /wallet/otp/verify setelah OTP valid.
    await this.walletInvites.assertCanCreateWallet(
      req.user.userId,
      body.walletInviteCode,
    );

    // Issue OTP purpose='wallet' (terpisah dari OTP register).
    const { devOtp } = await this.auth.issueWalletCreationOtp(
      req.user.userId,
      user.email,
    );

    // Beri tahu client kapan OTP akan expired (untuk countdown timer UI).
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return {
      message: 'Verification code sent to your email.',
      expiresAt,
      devOtp,
    };
  }

  @Post('wallet/otp/verify')
  async verifyWalletOtp(
    @Req() req: AuthedReq,
    @Body() body: VerifyWalletOtpDto,
  ): Promise<
    | {
        username: string;
        cantonPartyId: string;
        isPlaceholder: boolean;
        spliceOnboarded: boolean;
        preapproval: { active: boolean };
        message: string;
      }
    | {
        /** M2: jalur non-custodial — OTP valid, lanjut key ceremony di browser. */
        needsKeyCeremony: true;
        message: string;
      }
  > {
    // 1. Verify OTP.
    await this.auth.verifyWalletCreationOtp(req.user.userId, body.code);

    // M5: Custodial path REMOVED — ALL wallets are non-custodial (key ceremony).
    return {
      needsKeyCeremony: true as const,
      message: 'Email verified. Continue with your wallet key ceremony.',
    };
  }

  // M5 cleanup: dead custodial onboarding + deprecated allocate method removed.
  // Semua pembuatan wallet kini non-custodial (external-wallet.controller).
}
