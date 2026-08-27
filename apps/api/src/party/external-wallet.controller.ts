/**
 * Onboarding wallet EXTERNAL (non-custodial) — M2.
 *
 * Dua endpoint, kunci private tidak pernah keluar browser:
 *   POST /party/wallet-external/prepare   { publicKeyHex, partyHint }
 *     → { multiHash, partyIdPreview }     (topology digenerate, belum commit)
 *   POST /party/wallet-external/complete  { signature, username?, walletInviteCode? }
 *     → { cantonPartyId, walletKind: 'external' }  (party aktif di validator)
 *
 * Perbedaan penting vs jalur custodial lama (party-wallet.controller):
 *   - TIDAK ada pembuatan user Keycloak / party di Splice namespace validator.
 *   - TIDAK ada grant CanActAs operator (M0: participant menolak submit actAs
 *     party external — rights penulisan tidak diberikan sama sekali).
 *   - Hanya CanReadAs untuk admin (sink saldo server-side tetap jalan).
 *   - recordPartyRegistration (Daml WalletRegistrationProposal.Accept)
 *     sengaja DILEWATI di sini — Accept untuk party external wajib di-sign
 *     user via interactive submission (dibangun di M3), mustahil custodial.
 *
 * Feature flag EXTERNAL_WALLET_ENABLED (default off) — dual-run dengan
 * jalur lama sampai migrasi (M4) selesai.
 */
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ExternalWalletService } from '../canton/external-wallet.service';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { UsersService } from '../users/users.service';
import { WalletInviteCodeService } from './wallet-invite-code.service';
import {
  CompleteExternalWalletDto,
  PrepareExternalWalletDto,
} from './dto/external-wallet.dto';
import { hasRealWallet } from '../common/wallet-policy';
import { normalizeWalletUsername } from '../common/canton-party-id';
import type { AuthedReq } from './party-shared';

@Controller('party/wallet-external')
@UseGuards(AuthGuard('jwt'))
export class ExternalWalletController {
  private readonly logger = new Logger(ExternalWalletController.name);

  constructor(
    private readonly externalWallet: ExternalWalletService,
    private readonly ledger: CantonLedgerService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly users: UsersService,
    private readonly walletInvites: WalletInviteCodeService,
  ) {}

  private assertEnabled(): void {
    if (!this.externalWallet.isEnabled) {
      throw new ServiceUnavailableException(
        'Non-custodial wallet is not enabled yet.',
      );
    }
  }

  /** Langkah 1 — generate topology + multiHash untuk ditandatangani browser. */
  @Post('prepare')
  async prepare(@Req() req: AuthedReq, @Body() dto: PrepareExternalWalletDto) {
    this.assertEnabled();

    const existing = await this.users.findById(req.user.userId);
    if (!existing) throw new BadRequestException('User not found');
    if (hasRealWallet(existing.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    return this.externalWallet.prepare(
      req.user.userId,
      dto.publicKeyHex,
      dto.partyHint,
    );
  }

  /** Langkah 2 — allocate dengan signature user, lalu bind ke akun. */
  @Post('complete')
  async complete(@Req() req: AuthedReq, @Body() dto: CompleteExternalWalletDto) {
    this.assertEnabled();

    const existing = await this.users.findById(req.user.userId);
    if (!existing) throw new BadRequestException('User not found');
    if (hasRealWallet(existing.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const username = dto.username
      ? normalizeWalletUsername(dto.username) ?? undefined
      : undefined;
    if (dto.username && (!username || username.length < 3)) {
      throw new BadRequestException('Username must be at least 3 characters.');
    }
    if (username) {
      const taken = await this.users.findByUsernameInsensitive(username);
      if (taken && taken.id !== req.user.userId) {
        throw new ConflictException('Party ID Already Taken');
      }
    }

    // Invite flow — mirror jalur custodial (assert di awal, release saat gagal).
    const needsInviteFlow = !hasRealWallet(existing.cantonPartyId);
    await this.walletInvites.assertCanCreateWallet(
      req.user.userId,
      dto.walletInviteCode,
    );

    try {
      const { partyId } = await this.externalWallet.complete(
        req.user.userId,
        dto.signature,
      );

      const partyOwner = await this.users.findByPartyId(partyId);
      if (partyOwner && partyOwner.id !== req.user.userId) {
        throw new ConflictException('Party ID Already Taken');
      }

      {
        try {
          await this.users.setExternalCantonIdentity(req.user.userId, {
            partyId,
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
      }

      if (needsInviteFlow) {
        await this.walletInvites.redeemAfterWalletCreated(
          req.user.userId,
          dto.walletInviteCode,
        );
        await this.walletInvites.recordAllocation({
          userId: req.user.userId,
          username: username ?? '',
          partyId,
        });
      }

      // Rights penuh (CanActAs+CanReadAs) untuk admin — DIBUTUHKAN agar userId
      // admin bisa mensubmit interactive-execution hasil sign user (M3), dan
      // tetap AMAN: M0-strict membuktikan participant menolak submit actAs
      // party external tanpa tanda tangan pemilik kunci, apapun rights-nya.
      await this.ledger.grantUserRights(partyId).catch((err) => {
        this.logger.warn(
          `grantUserRights (external) gagal (non-fatal): ${String(err).slice(0, 120)}`,
        );
      });

      void this.featuredActivity
        .recordActivity('wallet_created', partyId, 'External wallet created')
        .catch(() => {
          /* non-critical */
        });

      this.logger.log(
        `Wallet external aktif: user=${req.user.userId.slice(0, 8)}… party=${partyId.split('::')[0]}`,
      );

      return {
        cantonPartyId: partyId,
        walletKind: 'external' as const,
        message:
          'Non-custodial wallet created — your key, your signature, your funds.',
      };
    } catch (err) {
      if (needsInviteFlow) {
        await this.walletInvites.releaseReservation(
          req.user.userId,
          dto.walletInviteCode,
        );
      }
      this.externalWallet.discard(req.user.userId);
      throw err;
    }
  }
}
