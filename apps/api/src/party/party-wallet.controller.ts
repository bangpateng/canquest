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
import { WalletOnboardingService } from '../canton/wallet-onboarding.service';
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
    private readonly walletOnboarding: WalletOnboardingService,
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
  ): Promise<{
    username: string;
    cantonPartyId: string;
    isPlaceholder: boolean;
    spliceOnboarded: boolean;
    preapproval: { active: boolean };
    message: string;
  }> {
    // 1. Verify OTP (auth service throw kalau invalid / expired / lockout).
    await this.auth.verifyWalletCreationOtp(req.user.userId, body.code);

    // 2. Execute onboarding (logic sama seperti setUsername).
    const result = await this.executeWalletOnboarding(req.user.userId, {
      username: body.username,
      firstName: body.firstName,
      lastName: body.lastName,
      walletInviteCode: body.walletInviteCode,
    });

    // 3. Kirim confirmation email (best-effort, never throws).
    void this.resend
      .sendWalletCreatedEmail(req.user.email, {
        username: result.username,
        partyId: result.cantonPartyId,
        displayName: undefined, // bisa di-enhance: baca displayName dari User
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Wallet-created email failed for ${req.user.email}: ${String(err)}`,
        );
      });

    return result;
  }

  /**
   * Onboarding wallet lengkap — di-refactor dari setUsername supaya bisa dipanggil
   * ulang oleh /wallet/otp/verify. Logic identik dengan setUsername versi lama,
   * hanya diekstrak ke method privat.
   */
  private async executeWalletOnboarding(
    userId: string,
    params: {
      username: string;
      firstName?: string;
      lastName?: string;
      walletInviteCode?: string;
    },
  ): Promise<{
    username: string;
    cantonPartyId: string;
    isPlaceholder: boolean;
    spliceOnboarded: boolean;
    preapproval: { active: boolean };
    message: string;
  }> {
    const username = normalizeWalletUsername(params.username) ?? '';
    if (username.length < 3) {
      throw new BadRequestException('Username must be at least 3 characters.');
    }

    const existing = await this.users.findById(userId);
    if (!existing) throw new BadRequestException('User not found');
    if (hasRealWallet(existing.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const taken = await this.users.findByUsernameInsensitive(username);
    if (taken && taken.id !== userId) {
      throw new ConflictException('Party ID Already Taken');
    }

    const needsInviteFlow = !hasRealWallet(existing.cantonPartyId);
    const inviteCode = params.walletInviteCode;

    if (needsInviteFlow) {
      await this.walletInvites.assertCanCreateWallet(userId, inviteCode);
    }

    let cantonPartyId: string;
    try {
      const { keycloakId, partyId } =
        await this.walletOnboarding.onboardWalletForUser({
          username,
          email: existing.email,
          firstName: params.firstName,
          lastName: params.lastName,
        });
      cantonPartyId = normalizeCantonPartyId(partyId) ?? partyId;

      const partyOwner = await this.users.findByPartyId(cantonPartyId);
      if (partyOwner && partyOwner.id !== userId) {
        throw new ConflictException('Party ID Already Taken');
      }

      this.assertPartyOnValidatorParticipant(cantonPartyId);

      try {
        await this.users.setCantonIdentity(userId, {
          partyId: cantonPartyId,
          keycloakId,
          username,
        });
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          throw new ConflictException('Party ID Already Taken');
        }
        throw err;
      }

      if (needsInviteFlow) {
        await this.walletInvites.redeemAfterWalletCreated(userId, inviteCode);
        await this.walletInvites.recordAllocation({
          userId,
          username,
          partyId: cantonPartyId,
        });
      }

      void this.featuredActivity
        .recordActivity(
          'wallet_created',
          cantonPartyId,
          `Wallet created for @${username}`,
        )
        .catch(() => {
          /* non-critical */
        });

      // TransferPreapproval: DEFAULT OFF (sama seperti setUsername).
      let preapprovalActive = false;
      const existingPreapproval =
        await this.splice.hasTransferPreapproval(cantonPartyId);
      if (existingPreapproval) {
        preapprovalActive = true;
      }

      if (needsInviteFlow) {
        void this.questLedger
          .recordPartyRegistration({
            userPartyId: cantonPartyId,
            username,
            inviteCode: inviteCode ?? '',
            userId, // v28: utk userProfileRef "user:<userId>" (param method)
            spliceOnboarded: true,
            preapprovalActive,
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `PartyRegistration ledger record failed: ${String(err)}`,
            );
          });
      }

      const message = preapprovalActive
        ? 'Wallet created — Party ID registered. Direct CC transfers enabled (CIP-56 compliant).'
        : 'Wallet created — Party ID registered. CC transfers work via offer/accept flow.';

      return {
        username,
        cantonPartyId,
        isPlaceholder: false,
        spliceOnboarded: true,
        preapproval: { active: preapprovalActive },
        message,
      };
    } catch (err) {
      if (needsInviteFlow) {
        await this.walletInvites.releaseReservation(userId, inviteCode);
      }
      throw err;
    }
  }

  @Post('allocate')
  async allocateCantonParty(
    @Req() req: AuthedReq,
    @Body() body: AllocateWalletDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found');

    if (hasRealWallet(user.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const username =
      normalizeWalletUsername(user.username) ?? `cq-${user.id.slice(0, 10)}`;

    const needsInviteFlow = !hasRealWallet(user.cantonPartyId);
    const inviteCode = body.walletInviteCode;

    if (needsInviteFlow) {
      await this.walletInvites.assertCanCreateWallet(
        req.user.userId,
        inviteCode,
      );
    }

    try {
      const splicePartyId = await this.splice.createWalletUser(username);
      if (!splicePartyId && (await this.splice.getUserPartyId(username))) {
        throw new ConflictException('Party ID Already Taken');
      }
      if (splicePartyId) {
        this.assertPartyOnValidatorParticipant(splicePartyId);
        const partyOwner = await this.users.findByPartyId(splicePartyId);
        if (partyOwner && partyOwner.id !== req.user.userId) {
          throw new ConflictException('Party ID Already Taken');
        }
        await this.users.setPartyId(req.user.userId, splicePartyId, username);
        const storedPartyId =
          normalizeCantonPartyId(splicePartyId) ?? splicePartyId;
        if (needsInviteFlow) {
          await this.walletInvites.redeemAfterWalletCreated(
            user.id,
            inviteCode,
          );
          await this.walletInvites.recordAllocation({
            userId: user.id,
            username,
            partyId: storedPartyId,
          });
        }
        // DEFAULT OFF: jangan auto-create preapproval. User enable manual via Wallet.
        const preapprovalActive = false;
        return {
          cantonPartyId: storedPartyId,
          isPlaceholder: false,
          spliceOnboarded: true,
          preapproval: { active: preapprovalActive },
          message:
            'Wallet created — Party ID allocated and registered in Splice validator.',
        };
      }

      const cantonPartyId = await this.ledger.allocateParty(username);
      this.assertPartyOnValidatorParticipant(cantonPartyId);
      await this.users.setPartyId(
        req.user.userId,
        cantonPartyId,
        user.username ?? undefined,
      );
      const storedPartyId =
        normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId;
      if (needsInviteFlow) {
        await this.walletInvites.redeemAfterWalletCreated(user.id, inviteCode);
        await this.walletInvites.recordAllocation({
          userId: user.id,
          username,
          partyId: storedPartyId,
        });
      }
      return {
        cantonPartyId: storedPartyId,
        isPlaceholder: false,
        spliceOnboarded: false,
        message:
          'Party ID allocated on Canton participant. Set CANTON_VALIDATOR_URL for full Splice registration.',
      };
    } catch (err) {
      if (needsInviteFlow) {
        await this.walletInvites.releaseReservation(
          req.user.userId,
          inviteCode,
        );
      }
      throw err;
    }
  }
}
