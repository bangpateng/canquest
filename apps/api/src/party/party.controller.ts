import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import { CantonLedgerService } from '../canton/canton-ledger.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { WalletOnboardingService } from '../canton/wallet-onboarding.service';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { CcBalanceService } from '../canton/cc-balance.service';
import { TransactionDetailService } from '../canton/transaction-detail.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import { ModoApiService } from '../canton/modo-api.service';
import { parseLockTerms } from '../canton/lock-terms';
import {
  cantonPartyIdsEqual,
  looksLikeCantonPartyId,
  normalizeCantonPartyId,
  normalizeWalletUsername,
  participantSuffixFromParty,
  participantSuffixesMatch,
  spliceWalletUsernameFromParty,
} from '../common/canton-party-id';
import { hasRealWallet } from '../common/wallet-policy';
import { UsersService } from '../users/users.service';
import { WalletPasswordService } from '../users/wallet-password.service';
import { feePartyLabels } from '../users/cc-transaction-visibility';
import { WalletInviteCodeService } from './wallet-invite-code.service';
import { AllocateWalletDto } from './dto/allocate-wallet.dto';
import { CantonPartyBindingDto } from './dto/canton-party-binding.dto';
import { SendCcDto } from './dto/send-cc.dto';
import { LockCcDto } from './dto/lock-cc.dto';
import { UnlockCcDto } from './dto/unlock-cc.dto';
import { SetUsernameDto } from './dto/set-username.dto';
import {
  SetWalletPasswordDto,
  RemoveWalletPasswordDto,
} from './dto/wallet-password.dto';
import {
  ContractActionDto,
  OfferType,
  TransferInstructionActionDto,
} from './dto/contract-action.dto';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyController {
  private readonly logger = new Logger(PartyController.name);

  /** Cooldown toggle preapproval: 1× per 7 hari (tiap re-enable burn ~1.5 CC). */
  private static readonly PREAPPROVAL_TOGGLE_COOLDOWN_MS =
    7 * 24 * 60 * 60 * 1000;

  /** Lempar 400 jika masih dalam cooldown 7 hari sejak toggle terakhir. */
  private assertPreapprovalToggleCooldown(
    toggledAt: Date | null | undefined,
  ): void {
    if (!toggledAt) return;

    const elapsed = Date.now() - new Date(toggledAt).getTime();
    const remaining = PartyController.PREAPPROVAL_TOGGLE_COOLDOWN_MS - elapsed;

    if (remaining > 0) {
      const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));

      // Format tanggal menjadi format yang mudah dibaca, misal: "June 27, 2026"
      const nextDate = new Date(Date.now() + remaining);
      const nextAtFormatted = nextDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      throw new BadRequestException(
        `Preapproval settings are limited to once per week. ` +
          `Please try again in ~${days} day(s) (after ${nextAtFormatted}).`,
      );
    }
  }

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly ccBalance: CcBalanceService,
    private readonly txDetail: TransactionDetailService,
    private readonly config: ConfigService,
    private readonly walletInvites: WalletInviteCodeService,
    private readonly questLedger: QuestLedgerService,
    private readonly walletOnboarding: WalletOnboardingService,
    private readonly lockEligibility: LockEligibilityService,
    private readonly prisma: PrismaService,
    private readonly walletPassword: WalletPasswordService,
    private readonly modo: ModoApiService,
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

  /**
   * Party IDs owned by the platform itself. User-to-user transfers must never
   * target these — they are the validator / reward / fee / operator wallets.
   * Returning true here blocks the send-cc flow before it touches the ledger.
   */
  private isSystemPartyId(partyId: string): boolean {
    const candidates = [
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID'),
      this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID'),
      this.config.get<string>('CANTON_REWARD_PARTY_ID'),
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID'),
      this.config.get<string>('CANTON_FEE_PARTY_ID'),
      this.config.get<string>('CANTON_OPERATOR_PARTY_ID'),
    ];
    return candidates.some(
      (c) => !!c?.trim() && cantonPartyIdsEqual(c, partyId),
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

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('username')
  async setUsername(@Req() req: AuthedReq, @Body() body: SetUsernameDto) {
    const username = normalizeWalletUsername(body.username) ?? '';
    if (username.length < 3) {
      throw new BadRequestException('Username must be at least 3 characters.');
    }
    const existing = await this.users.findById(req.user.userId);
    if (!existing) {
      throw new BadRequestException('User not found');
    }

    if (hasRealWallet(existing.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const taken = await this.users.findByUsernameInsensitive(username);
    if (taken && taken.id !== req.user.userId) {
      throw new ConflictException('Party ID Already Taken');
    }

    const needsInviteFlow = !hasRealWallet(existing.cantonPartyId);
    const inviteCode = body.walletInviteCode;

    if (needsInviteFlow) {
      await this.walletInvites.assertCanCreateWallet(
        req.user.userId,
        inviteCode,
      );
    }

    let cantonPartyId: string;
    try {
      // ── Keycloak model: onboard via WalletOnboardingService ──────
      const { keycloakId, partyId } =
        await this.walletOnboarding.onboardWalletForUser({
          username,
          email: existing.email,
        });
      cantonPartyId = normalizeCantonPartyId(partyId) ?? partyId;

      const partyOwner = await this.users.findByPartyId(cantonPartyId);
      if (partyOwner && partyOwner.id !== req.user.userId) {
        throw new ConflictException('Party ID Already Taken');
      }

      this.assertPartyOnValidatorParticipant(cantonPartyId);

      // Simpan atomik: partyId + keycloakId
      try {
        await this.users.setCantonIdentity(req.user.userId, {
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

      // Redeem invite HANYA setelah onboarding + simpan sukses
      if (needsInviteFlow) {
        await this.walletInvites.redeemAfterWalletCreated(
          req.user.userId,
          inviteCode,
        );
        await this.walletInvites.recordAllocation({
          userId: req.user.userId,
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

      // TransferPreapproval: DEFAULT OFF.
      // JANGAN auto-create saat register — biarkan OFF supaya SEMUA CC masuk
      // (reward/transfer/spin) jadi offer yang harus di-accept manual. User
      // baru bisa meng-enable sendiri via menu Wallet bila ingin transfer instan.
      // Jika user sebelumnya sudah enable (existing), pertahankan apa adanya.
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
        await this.walletInvites.releaseReservation(
          req.user.userId,
          inviteCode,
        );
      }
      throw err;
    }
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('ensure-preapproval')
  async ensurePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      throw new BadRequestException(
        'Create your wallet first from the Wallet page.',
      );
    }
    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException(
        'Party ID is still a placeholder. Run POST /party/allocate when the Splice tunnel is active.',
      );
    }

    const preferredUsername =
      spliceWalletUsernameFromParty(user.cantonPartyId) ??
      normalizeWalletUsername(user.username);
    if (!preferredUsername) {
      throw new BadRequestException(
        'Could not resolve Splice wallet username for this party.',
      );
    }

    let walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      preferredUsername;

    if (!(await this.splice.canAccessWalletAs(walletUsername))) {
      const onboard = await this.splice.ensureSpliceWalletUser(
        preferredUsername,
        user.cantonPartyId,
      );
      if (!onboard.ok) {
        this.logger.warn(
          `ensurePreapproval onboard failed user=${user.id.slice(0, 8)} @${preferredUsername}: ${onboard.detail ?? ''}`,
        );
        throw new BadRequestException(
          onboard.detail ?? 'Wallet not registered in Splice.',
        );
      }
      walletUsername = onboard.username ?? preferredUsername;
    }

    // Authoritative existence check across BOTH ledger views + splice. A plain
    // splice read that returns false on a transient error must NOT trigger a
    // re-create here — that would silently re-enable the preapproval the user
    // believes they disabled.
    const spliceExisting = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const existingAuth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceExisting !== null,
        expiresAt: spliceExisting?.expiresAt,
        provider: spliceExisting?.provider,
      },
    );
    if (existingAuth.active) {
      return {
        active: true,
        partyId: user.cantonPartyId,
        username: walletUsername,
        message: 'TransferPreapproval is already active (CIP-56).',
      };
    }

    const created = await this.splice.createTransferPreapproval(walletUsername);
    if (!created.ok) {
      const chainBalance = await this.splice.getUserBalance(walletUsername);
      const hint =
        chainBalance === null || chainBalance <= 0
          ? ` On-chain balance for @${walletUsername} is ${chainBalance ?? 0} CC — need funds for the preapproval fee (~$1/year). UI balance may be a DB snapshot.`
          : ` On-chain balance: ${chainBalance} CC (@${walletUsername}).`;
      this.logger.warn(
        `ensurePreapproval failed user=${user.id.slice(0, 8)} wallet=@${walletUsername} status=${created.status ?? '?'} ${created.detail ?? ''}`,
      );
      throw new BadRequestException(
        (created.detail ?? 'Failed to create TransferPreapproval.') + hint,
      );
    }

    void this.featuredActivity
      .recordActivity(
        'wallet_created',
        user.cantonPartyId,
        `Preapproval enabled for @${user.username}`,
      )
      .catch(() => {});

    return {
      active: true,
      partyId: user.cantonPartyId,
      username: walletUsername,
      message:
        'TransferPreapproval active — CC from the validator wallet can arrive directly (CIP-56).',
    };
  }

  @SkipThrottle()
  @Get('preapproval-status')
  async preapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      return {
        hasWallet: false,
        preapproval: { active: false, walletUiUrl: this.splice.walletUiUrl },
        message:
          'No wallet found. Create your wallet first from the Wallet page.',
      };
    }

    const [preapprovals, isPlaceholder] = await Promise.all([
      this.splice.getTransferPreapprovals(user.cantonPartyId),
      Promise.resolve(user.cantonPartyId.startsWith('canquest:')),
    ]);

    const active = preapprovals.length > 0;
    const walletUiUrl = this.splice.walletUiUrl;

    return {
      hasWallet: true,
      partyId: user.cantonPartyId,
      isPlaceholder,
      preapproval: {
        active,
        walletUiUrl,
        contracts: preapprovals,
        message: active
          ? `Preapproval active — direct CC transfers enabled. Expires: ${preapprovals[0]?.expiresAt ?? 'unknown'}`
          : 'No preapproval found. Visit your Splice Wallet UI and click "Create Preapproval" to enable direct CC transfers.',
      },
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
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

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('canton-binding')
  async bindCantonParty(
    @Req() req: AuthedReq,
    @Body() body: CantonPartyBindingDto,
  ) {
    const cantonPartyId = body.cantonPartyId.trim();
    this.assertPartyOnValidatorParticipant(cantonPartyId);
    await this.users.setPartyId(req.user.userId, cantonPartyId);
    return {
      cantonPartyId,
      isPlaceholder: false,
      message:
        'Canton Party ID saved manually. No ledger validation was performed.',
    };
  }

  @SkipThrottle()
  @Get('balance')
  async getBalance(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username) {
      return {
        balance: null,
        message: 'No wallet found. Create your wallet first.',
      };
    }
    const display = await this.ccBalance.getDisplayBalance(
      user.id,
      user.username,
      user.cantonPartyId,
    );
    return {
      username: user.username,
      balance: display.balance,
      unit: 'CC',
      source: display.source,
      stale: display.stale,
      updatedAt: display.updatedAt?.toISOString() ?? null,
    };
  }

  @Post('claim-reward')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  async claimReward(@Req() req: AuthedReq, @Body() body: unknown) {
    // Abuse signal: any authenticated user still hitting this disabled kran is
    // suspicious — log it so we can audit mainnet for probing attempts.
    this.logger.warn(
      `Blocked claim-reward attempt user=${req.user.userId.slice(0, 8)} body=${JSON.stringify(body).slice(0, 80)}`,
    );
    throw new ForbiddenException(
      'This endpoint has been disabled. Rewards are only available via quest flows.',
    );
  }

  /**
   * User-to-user CC transfer with platform fee.
   *
   * Transfer priority:
   *   Path A: sendViaTransferPreapproval (1-step, Splice validator decides if receiver has preapproval)
   *           → if fails (no preapproval), fall through to Path B
   *   Path B: Splice REST createTransferOffer + acceptOfferViaWallet (always works)
   *           → if receiver is external party, offer stays pending (receiver accepts manually)
   */
  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('send-cc')
  async sendCc(@Req() req: AuthedReq, @Body() body: SendCcDto) {
    const sender = await this.users.findById(req.user.userId);
    if (!sender?.username || !sender.cantonPartyId) {
      throw new BadRequestException(
        'You need a wallet to send CC. Create yours first.',
      );
    }

    // Gate kata sandi transaksi (opsional): wajib hanya bila user telah menetapkan satu.
    await this.walletPassword.assertGate(sender.id, body.walletPassword);

    // DTO (SendCcDto) already enforces: number, > 0, ≤ MAX_TRANSFER_CC, finite.
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0.');
    }

    const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5');
    const validatorPartyId =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';

    const recipientInput = body.recipientUsername?.trim();
    if (!recipientInput)
      throw new BadRequestException('Recipient is required.');

    let recipientPartyId: string;
    let recipientLabel: string;
    let recipientUsername: string | null = null;

    if (looksLikeCantonPartyId(recipientInput)) {
      const normalizedRecipient = normalizeCantonPartyId(recipientInput);
      if (!normalizedRecipient) {
        throw new BadRequestException('Invalid Party ID format.');
      }
      if (cantonPartyIdsEqual(normalizedRecipient, sender.cantonPartyId)) {
        throw new BadRequestException('You cannot send CC to yourself.');
      }
      // Block transfers to platform-owned wallets (validator/reward/fee/operator).
      if (this.isSystemPartyId(normalizedRecipient)) {
        this.logger.warn(
          `Blocked send-cc to system party: user=${sender.id.slice(0, 8)} target=${normalizedRecipient.split('::')[0]} amount=${amount}`,
        );
        throw new BadRequestException(
          'Transfers to platform wallets are not allowed.',
        );
      }
      recipientPartyId = normalizedRecipient;
      recipientLabel =
        normalizedRecipient.split('::')[0] ?? normalizedRecipient;
      const found = await this.users.findByPartyId(normalizedRecipient);
      recipientUsername =
        found?.username?.toLowerCase() ?? (recipientLabel || null);
    } else {
      const username = recipientInput.replace(/^@/, '').toLowerCase();
      if (username === sender.username?.toLowerCase()) {
        throw new BadRequestException('You cannot send CC to yourself.');
      }
      const dbUser = await this.users.findByUsernameInsensitive(username);
      const resolved =
        dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
      if (!resolved) {
        throw new BadRequestException(
          `User "@${username}" not found or has no wallet.`,
        );
      }
      recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
      if (this.isSystemPartyId(recipientPartyId)) {
        this.logger.warn(
          `Blocked send-cc to system wallet via @${username}: user=${sender.id.slice(0, 8)} amount=${amount}`,
        );
        throw new BadRequestException(
          'Transfers to platform wallets are not allowed.',
        );
      }
      recipientLabel = `@${username}`;
      recipientUsername = dbUser?.username?.toLowerCase() ?? username;
    }

    const description = body.memo?.trim() || `Sent to ${recipientLabel}`;
    const recipientDbUser = recipientUsername
      ? await this.users.findByUsernameInsensitive(recipientUsername)
      : null;
    const isInternalUser = recipientDbUser !== null;
    const effectiveFeeCc = feeCc;

    // ── Balance check (DB cache — fast path) ─────
    const dbBalance = await this.prisma.ccBalance.findUnique({
      where: { userId: sender.id },
      select: { balanceMicroCc: true },
    });
    if (dbBalance) {
      const cachedCc = Number(dbBalance.balanceMicroCc) / 1_000_000;
      if (cachedCc < amount + effectiveFeeCc) {
        throw new BadRequestException(
          effectiveFeeCc > 0
            ? `Insufficient balance. Need ${amount + effectiveFeeCc} CC (${amount} transfer + ${effectiveFeeCc} platform fee).`
            : `Insufficient balance. Need ${amount} CC.`,
        );
      }
    }
    // Kalau null → ledger akan menolak jika dana kurang

    // ── MAIN TRANSFER via CIP-0056 (satu-satunya jalur) ─────────────
    let accepted = false;
    let ledgerTxId: string | undefined;
    let transferMethod: 'direct' | 'offer_accept' | 'offer_only' =
      'offer_accept';

    const cip56Result = await this.ledger.executeTransferFactoryTransfer({
      senderPartyId: sender.cantonPartyId,
      receiverPartyId: recipientPartyId,
      amountCc: amount,
      description,
    });

    if (cip56Result.ok) {
      if (cip56Result.transferKind === 'direct') {
        accepted = true;
        transferMethod = 'direct';
        ledgerTxId = cip56Result.updateId ?? undefined;
        this.logger.log(
          `CC transfer direct: ${sender.username} → ${recipientLabel} ${amount} CC`,
        );
      } else if (cip56Result.transferKind === 'offer') {
        // Receiver tidak punya TransferPreapproval aktif.
        // JANGAN auto-accept — biarkan pending di inbox wallet receiver.
        // User terima/reject manual via menu Offers (POST /party/offers/accept|reject).
        ledgerTxId =
          cip56Result.transferInstructionCid ??
          cip56Result.updateId ??
          undefined;
        transferMethod = 'offer_only';
        this.logger.log(
          `CC transfer offer (pending): ${sender.username} → ${recipientLabel} ${amount} CC ` +
            `— recipient must accept via Offers menu`,
        );
      }
    }

    if (!cip56Result.ok) {
      throw new BadRequestException(
        `Transfer gagal: ${cip56Result.error?.slice(0, 120) ?? 'unknown'}`,
      );
    }

    // ── FEE COLLECT (HANYA jika transfer berhasil) ───────────────────
    let feeCollected = false;
    let feeLedgerTxId: string | undefined;
    let feeTreasuryPartyId: string | undefined;

    if (effectiveFeeCc > 0 && sender.cantonPartyId && accepted) {
      const feeParty =
        this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
        validatorPartyId;
      if (feeParty) {
        try {
          const feeResult = await this.ledger.executeTransferFactoryTransfer({
            senderPartyId: sender.cantonPartyId,
            receiverPartyId: feeParty,
            amountCc: effectiveFeeCc,
            description: `Platform fee: ${recipientLabel}`,
          });
          if (feeResult.ok && feeResult.transferKind === 'direct') {
            feeCollected = true;
            feeLedgerTxId = feeResult.updateId ?? undefined;
            feeTreasuryPartyId = feeParty;
            await this.users.recordTransaction({
              userId: sender.id,
              amountCc: effectiveFeeCc,
              type: 'TRANSFER_OUT',
              description: `Platform fee (transfer to ${recipientLabel})`,
              // Penanda "fee:" → filter visibility A3 sembunyikan baris ini dari history user.
              referenceId: `fee:${normalizeCantonPartyId(feeParty) ?? feeParty}`,
              ledgerTxId: feeLedgerTxId,
            });
            this.logger.log(
              `Fee collected: ${sender.username} → ${feeParty.split('::')[0]} ${effectiveFeeCc} CC (direct)`,
            );
          } else if (
            feeResult.ok &&
            feeResult.transferKind === 'offer' &&
            feeResult.transferInstructionCid
          ) {
            const acceptR = await this.ledger.acceptTransferInstruction(
              feeResult.transferInstructionCid,
              feeParty,
            );
            if (acceptR.ok) {
              feeCollected = true;
              feeLedgerTxId =
                acceptR.updateId ?? feeResult.updateId ?? undefined;
              feeTreasuryPartyId = feeParty;
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: effectiveFeeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (transfer to ${recipientLabel})`,
                // Penanda "fee:" → filter visibility A3 sembunyikan baris ini dari history user.
                referenceId: `fee:${normalizeCantonPartyId(feeParty) ?? feeParty}`,
                ledgerTxId: feeLedgerTxId,
              });
              this.logger.log(
                `Fee collected: ${sender.username} → ${feeParty.split('::')[0]} ${effectiveFeeCc} CC (offer-accept)`,
              );
            } else {
              this.logger.warn(
                `Fee offer accept failed: transfer proceeds without fee`,
              );
            }
          } else {
            this.logger.warn(
              `Fee NOT collected (transferKind=${feeResult.transferKind}, ok=${feeResult.ok}). Transfer proceeds.`,
            );
          }
        } catch (feeErr) {
          this.logger.warn(
            `Fee collect error (non-blocking): ${String(feeErr)}`,
          );
        }
      }
    }

    // ── Step 3: Record + response ──────────────────────────────────────
    let transferTransactionId: string | undefined;
    if (accepted) {
      const outRow = await this.users.recordTransaction({
        userId: sender.id,
        amountCc: amount,
        type: 'TRANSFER_OUT',
        description,
        counterparty: recipientPartyId,
        ledgerTxId: ledgerTxId,
      });
      transferTransactionId = outRow.id;
      if (ledgerTxId && sender.cantonPartyId) {
        void this.txDetail.backfillUpdateId(
          outRow.id,
          ledgerTxId,
          sender.cantonPartyId,
        );
      }

      if (sender.cantonPartyId) {
        void this.featuredActivity
          .recordActivity(
            'cc_transfer',
            sender.cantonPartyId,
            `CC transfer ${amount} CC to ${recipientLabel}`,
          )
          .catch(() => {});
      }

      if (isInternalUser && recipientDbUser) {
        await this.users.recordTransaction({
          userId: recipientDbUser.id,
          amountCc: amount,
          type: 'TRANSFER_IN',
          description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
          counterparty:
            normalizeCantonPartyId(sender.cantonPartyId) ??
            sender.cantonPartyId,
          ledgerTxId: ledgerTxId,
        });
        if (recipientDbUser.username) {
          void this.inboundSync.alignBalanceFromChain(
            recipientDbUser.id,
            recipientDbUser.username,
          );
        }
      }
      if (sender.username) {
        void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
      }
    }

    // ── Offer-only: return pending status (not an error) ─────────────────
    if (transferMethod === 'offer_only') {
      const pendingRow = await this.users.recordTransaction({
        userId: sender.id,
        amountCc: amount,
        type: 'TRANSFER_OUT',
        description: `${description} [pending — recipient must accept offer]`,
        counterparty: recipientPartyId,
        ledgerTxId,
        // Status PENDING: dana sudah keluar sebagai offer, tapi belum diterima
        // receiver. Saat offer di-accept, acceptOfferInbox update ke COMPLETED.
        status: 'PENDING',
        transferInstructionCid: cip56Result.transferInstructionCid ?? null,
      });
      void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
      return {
        success: true,
        from: sender.username,
        to: recipientLabel,
        amount,
        fee: feeCc,
        feeCollected,
        totalDeducted: feeCollected ? feeCc : 0,
        accepted: false,
        offerPending: true,
        offerContractId: ledgerTxId,
        message: `Transfer offer created for ${amount} CC to ${recipientLabel}. The recipient must accept this offer manually (different participant wallet). Offer ID: ${ledgerTxId?.slice(0, 20)}…`,
        transactionId: pendingRow.id,
      };
    }

    const totalDeducted = amount + (feeCollected ? feeCc : 0);
    const message = `Sent ${amount} CC to ${recipientLabel} (platform fee ${feeCc} CC).`;

    if (sender.cantonPartyId && accepted) {
      void this.questLedger
        .recordCcTransfer({
          senderPartyId: sender.cantonPartyId,
          recipientPartyId,
          amountCc: amount,
          feeCc: feeCollected ? feeCc : 0,
          totalDeductedCc: totalDeducted,
          memo: body.memo?.trim(),
          transferTxId: ledgerTxId,
          feeTxId: feeLedgerTxId,
          transferKind: 'USER_TO_USER',
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `CcTransferRecord ledger record failed: ${String(err)}`,
          );
        });
    }

    return {
      success: true,
      from: sender.username,
      to: recipientLabel,
      amount,
      fee: feeCc,
      feeCollected,
      totalDeducted,
      accepted: true,
      transferMethod,
      message,
      transactionId: transferTransactionId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIP-0056 Two-Step Transfer — TransferInstruction endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('transfer-instruction/accept')
  async acceptTransferInstruction(
    @Req() req: AuthedReq,
    @Body() body: TransferInstructionActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid)
      throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Accept: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.acceptTransferInstruction(
      cid,
      user.cantonPartyId,
    );

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to accept transfer instruction: ${result.error ?? 'unknown error'}`,
      );
    }

    const row = await this.users.recordTransaction({
      userId: user.id,
      amountCc: 0,
      type: 'TRANSFER_IN',
      description: 'Accepted incoming CC transfer (CIP-0056 Two-Step)',
      counterparty: 'sender',
      ledgerTxId: result.updateId ?? cid,
    });

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId: result.updateId,
      transactionId: row.id,
      message: 'Transfer accepted. CC will appear in your wallet shortly.',
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('transfer-instruction/reject')
  async rejectTransferInstruction(
    @Req() req: AuthedReq,
    @Body() body: TransferInstructionActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid)
      throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Reject: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.rejectTransferInstruction(
      cid,
      user.cantonPartyId,
    );

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to reject transfer instruction: ${result.error ?? 'unknown error'}`,
      );
    }

    // Catat history (tx id ASLI dari exercise). Non-fatal: onchain reject tetap
    // sukses walau pencatatan gagal — gap "terkirim tapi history gagal" dihindari.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'OFFER_REJECTED',
        description: 'Rejected incoming CC transfer',
        referenceId: cid,
        ledgerTxId: result.updateId ?? cid,
      });
    } catch (err) {
      this.logger.warn(
        `OFFER_REJECTED history record failed (cid=${cid.slice(0, 16)}): ${String(err)}`,
      );
    }

    return {
      ok: true,
      updateId: result.updateId,
      message: 'Transfer rejected. CC returned to sender.',
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('transfer-instruction/withdraw')
  async withdrawTransferInstruction(
    @Req() req: AuthedReq,
    @Body() body: TransferInstructionActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid)
      throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Withdraw: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.withdrawTransferInstruction(
      cid,
      user.cantonPartyId,
    );

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to withdraw transfer instruction: ${result.error ?? 'unknown error'}`,
      );
    }

    // Catat history (tx id ASLI dari exercise). Non-fatal.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'OFFER_WITHDRAWN',
        description: 'Cancelled outgoing CC transfer',
        referenceId: cid,
        ledgerTxId: result.updateId ?? cid,
      });
    } catch (err) {
      this.logger.warn(
        `OFFER_WITHDRAWN history record failed (cid=${cid.slice(0, 16)}): ${String(err)}`,
      );
    }

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId: result.updateId,
      message: 'Transfer cancelled. CC returned to your wallet.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Offer Inbox — list and manage incoming transfer offers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List all pending incoming transfer offers for the current user.
   * Returns both legacy Splice TransferOffers and CIP-0056 TransferInstructions.
   */
  @SkipThrottle()
  @Get('offers')
  async listOffers(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    let offers = await this.ledger.queryPendingOffers(user.cantonPartyId);

    // Fallback: kalau ACS kosong, coba Splice Wallet API langsung
    if (offers.length === 0 && user.username) {
      const spliceOffers = await this.splice.listTransferOffers(user.username);
      if (spliceOffers.length > 0) {
        offers = spliceOffers.map((o) => ({
          type: 'transfer_offer' as const,
          contractId: o.contractId,
          sender: '',
          receiver: user.cantonPartyId!,
          amount: '0',
          description: 'Incoming transfer (Splice Wallet)',
          expiresAt: '',
          createdAt: '',
        }));
        this.logger.log(
          `Fallback Splice: ${offers.length} offers for @${user.username}`,
        );
      }
    }

    // Resolve sender labels from DB where possible
    const enriched = await Promise.all(
      offers.map(async (offer) => {
        let senderLabel = offer.sender.split('::')[0] ?? offer.sender;
        try {
          const senderUser = await this.users.findByPartyId(offer.sender);
          if (senderUser?.username) senderLabel = `@${senderUser.username}`;
        } catch {
          /* keep party hint */
        }
        return { ...offer, senderLabel };
      }),
    );

    return {
      offers: enriched,
      total: enriched.length,
      legacyCount: enriched.filter((o) => o.type === 'transfer_offer').length,
      cip56Count: enriched.filter((o) => o.type === 'transfer_instruction')
        .length,
    };
  }

  /**
   * Accept a pending transfer offer (auto-detects type: legacy or CIP-0056).
   */
  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('offers/accept')
  async acceptOfferInbox(
    @Req() req: AuthedReq,
    @Body() body: ContractActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (
      !user?.cantonPartyId ||
      !user.username ||
      !hasRealWallet(user.cantonPartyId)
    ) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    const offerType = body.type ?? OfferType.TRANSFER_OFFER;
    this.logger.log(
      `Accept offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`,
    );

    // Lookup detail offer SEBELUM accept — setelah accept, offer hilang dari ledger.
    // amount + sender ini dipakai untuk catat TRANSFER_IN yang truthful di history.
    let amountCc = 0;
    let senderLabel = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        cid,
        user.cantonPartyId,
      );
      if (detail) {
        amountCc = parseFloat(detail.amount) || 0;
        senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
      }
    } catch (err) {
      this.logger.warn(`lookupOfferDetail (accept) failed: ${String(err)}`);
    }

    let ok = false;
    let updateId: string | null = null;

    if (offerType === OfferType.TRANSFER_INSTRUCTION) {
      // CIP-0056 TransferInstruction
      const result = await this.ledger.acceptTransferInstruction(
        cid,
        user.cantonPartyId,
      );
      ok = result.ok;
      updateId = result.updateId;
      if (!ok) {
        throw new BadRequestException(
          `Failed to accept: ${result.error ?? 'unknown'}`,
        );
      }
    } else {
      // Legacy Splice TransferOffer — accept via Canton Ledger API.
      const result = await this.ledger.acceptTransferOffer(
        cid,
        user.cantonPartyId,
      );
      ok = result.accepted;
      updateId = result.updateId;
      if (!ok) {
        throw new BadRequestException('Failed to accept transfer offer.');
      }
    }

    // Reward yang tadinya PENDING (offer) kini diterima → tandai COMPLETED.
    // Jika baris reward kita yang cocok, JANGAN catat TRANSFER_IN baru: baris
    // reward sudah punya angka yang benar. Hanya transfer dari pihak lain yang dicatat.
    let settledOwnReward = 0;
    try {
      settledOwnReward = await this.users.markTransferInstructionSettled(
        cid,
        'COMPLETED',
      );
    } catch (err) {
      this.logger.warn(`markTransferInstructionSettled failed: ${String(err)}`);
    }

    if (settledOwnReward === 0) {
      // Transfer masuk dari pihak lain (bukan reward pending kita) → catat TRANSFER_IN.
      // Bila lookupOfferDetail gagal (amountCc = 0), coba tebus nilai asli dari
      // delta balance on-chain supaya history tidak menampilkan "Received 0 CC".
      let resolvedAmount = amountCc;
      if (resolvedAmount === 0) {
        try {
          const afterBal = await this.ledger.getLedgerBalance(
            user.cantonPartyId,
          );
          if (afterBal != null) {
            const beforeRow = await this.prisma.ccBalance.findUnique({
              where: { userId: user.id },
            });
            const beforeCc = beforeRow
              ? Number(beforeRow.balanceMicroCc) / 1_000_000
              : 0;
            resolvedAmount = Math.max(
              0,
              Math.round((afterBal - beforeCc) * 1e6) / 1e6,
            );
          }
        } catch (err) {
          this.logger.warn(
            `balance-delta amount resolve failed: ${String(err)}`,
          );
        }
      }

      const kindLabel =
        offerType === OfferType.TRANSFER_INSTRUCTION ? 'CIP-0056' : 'legacy';
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: resolvedAmount,
        type: 'TRANSFER_IN',
        description:
          resolvedAmount > 0
            ? `Received ${resolvedAmount} CC${senderLabel ? ` from ${senderLabel}` : ''}`
            : `Accepted incoming ${kindLabel} transfer`,
        counterparty: senderLabel || undefined,
        ledgerTxId: updateId ?? cid,
      });
    }

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId,
      message: 'Transfer accepted. CC will appear in your wallet shortly.',
    };
  }

  /**
   * Reject a pending transfer offer (auto-detects type: legacy or CIP-0056).
   */
  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('offers/reject')
  async rejectOfferInbox(
    @Req() req: AuthedReq,
    @Body() body: ContractActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    const offerType = body.type ?? OfferType.TRANSFER_OFFER;
    this.logger.log(
      `Reject offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`,
    );

    if (offerType === OfferType.TRANSFER_INSTRUCTION) {
      // Lookup detail SEBELUM reject — setelah reject, offer hilang dari ledger.
      let amountCc = 0;
      let senderLabel = '';
      try {
        const detail = await this.ledger.lookupOfferDetail(
          cid,
          user.cantonPartyId,
        );
        if (detail) {
          amountCc = parseFloat(detail.amount) || 0;
          senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        }
      } catch (err) {
        this.logger.warn(`lookupOfferDetail (reject) failed: ${String(err)}`);
      }

      const result = await this.ledger.rejectTransferInstruction(
        cid,
        user.cantonPartyId,
      );
      if (!result.ok) {
        throw new BadRequestException(
          `Failed to reject: ${result.error ?? 'unknown'}`,
        );
      }

      // Reward PENDING yang ditolak → tandai REJECTED. Transfer dari pihak lain
      // yang ditolak → catat jejak (amount 0, status REJECTED) supaya user tahu.
      let settledOwnReward = 0;
      try {
        settledOwnReward = await this.users.markTransferInstructionSettled(
          cid,
          'REJECTED',
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED failed: ${String(err)}`,
        );
      }
      if (settledOwnReward === 0) {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'TRANSFER_IN',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
          status: 'REJECTED',
        });
      }
      return {
        ok: true,
        updateId: result.updateId,
        message: 'Transfer rejected. CC returned to sender.',
      };
    } else {
      // Legacy Splice TransferOffer — lookup detail SEBELUM reject (offer hilang setelahnya).
      let amountCc = 0;
      let senderLabel = '';
      try {
        const detail = await this.ledger.lookupOfferDetail(
          cid,
          user.cantonPartyId,
        );
        if (detail) {
          amountCc = parseFloat(detail.amount) || 0;
          senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        }
      } catch (err) {
        this.logger.warn(
          `lookupOfferDetail (legacy reject) failed: ${String(err)}`,
        );
      }

      const result = await this.ledger.rejectTransferOffer(
        cid,
        user.cantonPartyId,
      );
      if (!result.rejected) {
        throw new BadRequestException('Failed to reject transfer offer.');
      }

      // Reward PENDING yang ditolak → tandai REJECTED. Transfer dari pihak lain
      // yang ditolak → catat jejak OFFER_REJECTED supaya user punya riwayatnya.
      let settledOwnReward = 0;
      try {
        settledOwnReward = await this.users.markTransferInstructionSettled(
          cid,
          'REJECTED',
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED (legacy) failed: ${String(err)}`,
        );
      }
      if (settledOwnReward === 0) {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'OFFER_REJECTED',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
        });
      }
      return {
        ok: true,
        updateId: result.updateId,
        message: 'Transfer offer rejected.',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Preapproval Toggle — enable/disable TransferPreapproval
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current preapproval status for the user's wallet.
   *
   * Uses the authoritative on-chain read (both Ledger ACS views + Splice REST
   * fallback). A plain Splice REST read can report inactive on any transient
   * error while a live contract keeps CC flowing in directly — so the source of
   * truth is the union of all sources.
   */
  @SkipThrottle()
  @Get('preapproval')
  async getPreapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    const spliceStatus = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const auth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceStatus !== null,
        expiresAt: spliceStatus?.expiresAt,
        provider: spliceStatus?.provider,
      },
    );

    return {
      active: auth.active,
      expiresAt: auth.expiresAt ?? null,
      provider: auth.provider ?? null,
      source: auth.source ?? null,
      message: auth.active
        ? 'Preapproval active — incoming CC transfers arrive directly without manual accept.'
        : 'Preapproval inactive — incoming CC transfers will appear as offers that you must accept manually.',
    };
  }

  /**
   * Enable TransferPreapproval — allows direct incoming CC transfers.
   */
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  @Post('preapproval/enable')
  async enablePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (
      !user?.cantonPartyId ||
      !user.username ||
      !hasRealWallet(user.cantonPartyId)
    ) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Already active? (Authoritative read across all sources — don't burn the
    // preapproval fee if one is already live that a single source missed.)
    const spliceExisting = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const existing = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceExisting !== null,
        expiresAt: spliceExisting?.expiresAt,
        provider: spliceExisting?.provider,
      },
    );
    if (existing.active) {
      return {
        ok: true,
        alreadyActive: true,
        expiresAt: existing.expiresAt,
        message: 'Preapproval is already active.',
      };
    }

    // Cooldown 7 hari (hanya gate aksi yang benar-benar burn)
    this.assertPreapprovalToggleCooldown(user.preapprovalToggleAt);

    // Create via Ledger: exercise AmuletRules_CreateTransferPreapproval (validator-1 pays burn)
    const result = await this.ledger.createTransferPreapprovalViaLedger(
      user.cantonPartyId,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error ?? 'Failed to create preapproval.',
      );
    }

    // Catat history (tx id = contract preapproval cid). Non-fatal: toggle tetap
    // sukses walau pencatatan gagal. Burn fee dicatat juga agar ada jejak.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: Number(result.amuletPaid ?? 0),
        type: 'PREAPPROVAL_ENABLED',
        description: 'Preapproval enabled — direct transfers',
        referenceId: user.cantonPartyId,
        ledgerTxId: result.transferPreapprovalCid ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `PREAPPROVAL_ENABLED history record failed: ${String(err)}`,
      );
    }

    // Sukses & burn terjadi → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    return {
      ok: true,
      alreadyActive: false,
      transferPreapprovalCid: result.transferPreapprovalCid,
      amuletPaid: result.amuletPaid,
      message:
        'Preapproval enabled — incoming CC transfers will now arrive directly.',
    };
  }

  /**
   * Disable TransferPreapproval — incoming CC will require manual accept.
   * Uses DELETE /v0/admin/transfer-preapprovals/by-party/{party}
   */
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  @Post('preapproval/disable')
  async disablePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Authoritative read — checks BOTH ledger views + splice. A false-negative
    // here would make us skip the cancel entirely, so we union every source.
    const spliceStatus = await this.splice.getTransferPreapproval(
      user.cantonPartyId,
    );
    const auth = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
      {
        active: spliceStatus !== null,
        expiresAt: spliceStatus?.expiresAt,
        provider: spliceStatus?.provider,
      },
    );
    if (!auth.active) {
      return {
        ok: true,
        wasActive: false,
        message: 'Preapproval is already inactive.',
      };
    }

    // Cooldown 7 hari (gate state-change)
    this.assertPreapprovalToggleCooldown(user.preapprovalToggleAt);

    // Cancel via Ledger (primary path). cancelTransferPreapprovalViaLedger now
    // re-verifies the contract is actually archived before reporting success.
    const result = await this.ledger.cancelTransferPreapprovalViaLedger(
      user.cantonPartyId,
    );
    if (!result.ok) {
      // Fallback: try Splice admin DELETE (sometimes the operator lacks CanActAs
      // on the receiver but the admin endpoint can archive it).
      const fallback = await this.splice.cancelTransferPreapproval(
        user.cantonPartyId,
      );
      if (!fallback.ok) {
        throw new BadRequestException(
          `Failed to disable preapproval: ${result.error ?? 'unknown'}`,
        );
      }
    }

    // Final verification — only trust the toggle succeeded if the authoritative
    // read now reports inactive. Otherwise surface the error so the UI does not
    // wrongly show "Disabled" while a live contract keeps CC flowing in.
    const postCheck = await this.ledger.getTransferPreapprovalAuthoritative(
      user.cantonPartyId,
    );
    if (postCheck.active) {
      throw new BadRequestException(
        'Preapproval could not be disabled on-chain — it is still active. ' +
          'Please retry in a moment, or contact support if it persists.',
      );
    }

    // Sukses & terverifikasi → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    // Catat history (tx id = updateId dari cancel exercise). Non-fatal: toggle
    // tetap sukses walau pencatatan gagal. Fallback marker bila updateId tidak
    // tersedia (e.g. lewat Splice fallback path).
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'PREAPPROVAL_DISABLED',
        description: 'Preapproval disabled — manual accept required',
        referenceId: user.cantonPartyId,
        ledgerTxId:
          result.updateId ??
          `preapproval:disable:${user.cantonPartyId}:${Date.now()}`,
      });
    } catch (err) {
      this.logger.warn(
        `PREAPPROVAL_DISABLED history record failed: ${String(err)}`,
      );
    }

    return {
      ok: true,
      wasActive: true,
      message:
        'Preapproval disabled — incoming CC transfers will now appear as offers.',
    };
  }

  @SkipThrottle()
  @Get('notifications')
  async getNotifications(
    @Req() req: AuthedReq,
    @Query('limit') limit?: string,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found.');
    const n = Math.min(30, Math.max(1, parseInt(limit ?? '12', 10) || 12));
    return this.users.getNotifications(user.id, n);
  }

  @SkipThrottle()
  @Post('notifications/seen')
  async markNotificationsSeen(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found.');
    return this.users.markNotificationsSeen(user.id);
  }

  @SkipThrottle()
  @Get('transactions')
  async getTransactions(
    @Req() req: AuthedReq,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found.');
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    // Cap 200 (sebelumnya 20) — history list fetch pageSize=200 untuk dapat semua
    // row user. Cap lama 20 membuat row di luar 20 terbaru tidak pernah muncul.
    const ps = Math.min(200, Math.max(1, parseInt(pageSize ?? '5', 10) || 5));
    return this.users.getTransactions(user.id, p, ps);
  }

  /**
   * Onchain transactions from the Lighthouse Explorer API for the user's party.
   *
   * NOTE: Must be declared BEFORE `@Get('transactions/:id')` so NestJS matches
   * the static `onchain` segment instead of treating it as the `:id` param.
   */
  @SkipThrottle()
  @Get('transactions/onchain')
  async getOnchainTransactions(
    @Req() req: AuthedReq,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const user = await this.users.findById(req.user.userId);
    const partyId = user?.cantonPartyId;

    // No real wallet → nothing to show onchain.
    if (!partyId || partyId.startsWith('canquest:')) {
      return { transactions: [], pagination: null };
    }

    const size = Math.min(50, Math.max(1, parseInt(limit ?? '15', 10) || 15));
    // Modo per-party endpoint is cursor-based; `cursor` is the opaque nextCursor
    // from the previous response (undefined = first/newest page).

    try {
      const result = await this.modo.getTransfersByParty(partyId, {
        size,
        cursor: cursor || undefined,
      });
      if (!result) {
        this.logger.warn(`Modo onchain fetch failed for party ${partyId.slice(0, 16)}…`);
        return { transactions: [], pagination: null };
      }

      // Network fee (CC) applied to every transfer — sourced from env so the
      // receipt shows a consistent fee even when the API omits it.
      const feeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '0.2',
      );
      const networkFeeMicroCc = String(Math.round(Math.abs(feeCc) * 1_000_000));

      // Fee party short labels — transfer ke party ini (canquest-fee/validator) disembunyikan
      // dari history on-chain agar konsisten dengan filter DB (CC_TRANSACTION_HISTORY_WHERE).
      const feeLabels = feePartyLabels();

      const isFeeParty = (party?: string): boolean => {
        if (typeof party !== 'string' || !party.trim()) return false;
        const v = party.trim();
        return feeLabels.some(
          (label) => v === label || v.startsWith(`${label}::`),
        );
      };

      // Normalize Modo transfers to the shape the frontend expects, inject
      // network_fee + scan_url (modo.link/transfers/{eventId}), and drop rows
      // whose only counterparty is a fee party.
      const transactions = result.transfers
        .filter((tx) => {
          if (feeLabels.length === 0) return true;
          const allParties = [
            ...tx.senders.map((s) => s.partyId),
            ...tx.receivers.map((r) => r.partyId),
          ];
          // Sembunyikan baris yang hanya melibatkan party fee (fee leg internal).
          return allParties.some((p) => !isFeeParty(p));
        })
        .map((tx) => ({
          event_id: tx.eventId,
          update_id: tx.eventId.replace(/:[0-9]+$/, ''),
          transfer_type: tx.transferType,
          amount: tx.amount,
          fee: tx.fee,
          amulet_price: tx.amuletPrice,
          created_at: tx.createdAt,
          sender_address: tx.senders[0]?.partyId ?? null,
          sender_name: tx.senders[0]?.accountName ?? null,
          receiver_address: tx.receivers[0]?.partyId ?? null,
          receiver_name: tx.receivers[0]?.accountName ?? null,
          network_fee: networkFeeMicroCc,
          scan_url: this.modo.explorerUrl(tx.eventId),
        }));

      return {
        transactions,
        pagination: {
          has_next: result.hasNextPage,
          next_cursor: result.nextCursor,
        },
      };
    } catch (err) {
      this.logger.warn(`Modo onchain fetch error: ${String(err)}`);
      return { transactions: [], pagination: null };
    }
  }

  @SkipThrottle()
  @Get('transactions/:id')
  async getTransactionById(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.txDetail.getDetailForUser(req.user.userId, id.trim());
  }

  @SkipThrottle()
  @Get('fee-config')
  getFeeConfig() {
    return {
      feeCc: Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5'),
      ccUsdPrice: Number(this.config.get<string>('CC_USD_PRICE') ?? '0'),
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('accept-offer')
  async acceptOffer(@Req() req: AuthedReq, @Body() body: ContractActionDto) {
    const contractId = body.contractId?.trim();
    if (!contractId) {
      throw new BadRequestException('contractId is required.');
    }

    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException(
        'Party ID is still a placeholder. Regenerate your wallet.',
      );
    }

    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      user.username;

    this.logger.log(
      `Accept offer requested: user=@${walletUsername} contractId=${contractId.slice(0, 20)}…`,
    );

    let accepted = false;
    let acceptMethod = '';

    const result = await this.ledger.acceptTransferOffer(
      contractId,
      user.cantonPartyId,
    );
    accepted = result.accepted;
    if (accepted) {
      acceptMethod = 'canton_ledger_api';
      this.logger.log(
        `Offer accepted via Canton Ledger API: ${contractId.slice(0, 20)}… updateId=${result.updateId?.slice(0, 16) ?? 'n/a'}`,
      );
    } else {
      this.logger.warn(
        `Canton Ledger API accept also failed for ${contractId.slice(0, 20)}…`,
      );
    }

    if (!accepted) {
      throw new BadRequestException(
        'Could not accept the transfer offer. The offer may have expired or been processed already.',
      );
    }

    // Lookup detail SEBELUM accept (offer hilang dari ledger setelah accept).
    let amountCc = 0;
    let senderLabel = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        contractId,
        user.cantonPartyId,
      );
      if (detail) {
        amountCc = parseFloat(detail.amount) || 0;
        senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
      }
    } catch (err) {
      this.logger.warn(
        `lookupOfferDetail (legacy accept) failed: ${String(err)}`,
      );
    }

    // Reward PENDING yang diterima → tandai COMPLETED. Transfer dari pihak lain
    // → catat TRANSFER_IN supaya muncul di history + notifikasi.
    let settledOwnReward = 0;
    try {
      settledOwnReward = await this.users.markTransferInstructionSettled(
        contractId,
        'COMPLETED',
      );
    } catch (err) {
      this.logger.warn(
        `markTransferInstructionSettled (legacy) failed: ${String(err)}`,
      );
    }
    if (settledOwnReward === 0) {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc,
        type: 'TRANSFER_IN',
        description:
          amountCc > 0
            ? `Received ${amountCc} CC${senderLabel ? ` from ${senderLabel}` : ''}`
            : 'Accepted incoming transfer',
        counterparty: senderLabel || undefined,
        ledgerTxId: result.updateId ?? contractId,
      });
    }

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      accepted: true,
      contractId,
      method: acceptMethod,
      message:
        'Transfer offer accepted. Funds should appear in your wallet shortly.',
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('reject-offer')
  async rejectOffer(@Req() req: AuthedReq, @Body() body: ContractActionDto) {
    const contractId = body.contractId?.trim();
    if (!contractId) {
      throw new BadRequestException('contractId is required.');
    }

    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException(
        'Party ID is still a placeholder. Regenerate your wallet.',
      );
    }

    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      user.username;

    this.logger.log(
      `Reject offer requested: user=@${walletUsername} contractId=${contractId.slice(0, 20)}…`,
    );

    const result = await this.ledger.rejectTransferOffer(
      contractId,
      user.cantonPartyId,
    );

    if (!result.rejected) {
      throw new BadRequestException(
        'Could not reject the transfer offer. The offer may have expired or been processed already.',
      );
    }

    // Lookup detail SEBELUM reject (offer hilang dari ledger setelah reject).
    let amountCc = 0;
    let senderLabel = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        contractId,
        user.cantonPartyId,
      );
      if (detail) {
        amountCc = parseFloat(detail.amount) || 0;
        senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
      }
    } catch (err) {
      this.logger.warn(
        `lookupOfferDetail (legacy reject) failed: ${String(err)}`,
      );
    }

    // Reward PENDING yang ditolak → tandai REJECTED. Transfer dari pihak lain
    // → catat OFFER_REJECTED supaya user punya riwayat + notifikasi.
    let settledOwnReward = 0;
    try {
      settledOwnReward = await this.users.markTransferInstructionSettled(
        contractId,
        'REJECTED',
      );
    } catch (err) {
      this.logger.warn(
        `markTransferInstructionSettled (legacy reject) failed: ${String(err)}`,
      );
    }
    if (settledOwnReward === 0) {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'OFFER_REJECTED',
        description:
          `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
          (amountCc > 0 ? ` (${amountCc} CC)` : ''),
        ledgerTxId: result.updateId ?? contractId,
      });
    }

    this.logger.log(
      `Offer rejected: @${walletUsername} contractId=${contractId.slice(0, 20)}… updateId=${result.updateId?.slice(0, 16) ?? 'n/a'}`,
    );

    return {
      rejected: true,
      contractId,
      updateId: result.updateId ?? null,
      message: 'Transfer offer rejected.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CC LOCK (non-custodial) — Spec CC Lock CanQuest
  // ownerParty di-resolve dari user login (JANGAN terima ownerParty mentah dari body).
  // ═══════════════════════════════════════════════════════════════════════════

  /** Helper: parse LOCK_TERM_OPTIONS sekali per request (murah, string kecil). */
  private getLockTerms() {
    return parseLockTerms(this.config.get<string>('LOCK_TERM_OPTIONS'));
  }

  /**
   * POST /party/lock — kunci amountCc CC selama termKey (validated against env).
   * Memakai cantonLedgerService.lockCc() (AmuletRules_Transfer → LockedAmulet).
   */
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  @Post('lock')
  async lockCc(@Req() req: AuthedReq, @Body() body: LockCcDto) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    // Gate kata sandi transaksi (opsional): wajib hanya bila user telah menetapkan satu.
    await this.walletPassword.assertGate(user.id, body.walletPassword);
    const ownerParty = user.cantonPartyId;

    const { map } = this.getLockTerms();
    const seconds = map.get(body.termKey);
    if (seconds === undefined) {
      throw new BadRequestException(`term "${body.termKey}" tidak valid`);
    }
    const amountCc = Number(body.amountCc);
    if (!Number.isFinite(amountCc) || amountCc <= 0) {
      throw new BadRequestException('amountCc must be greater than 0.');
    }

    this.logger.log(
      `lockCc: user=@${user.username} amount=${amountCc} term=${body.termKey} (${seconds}s)`,
    );

    const result = await this.ledger.lockCc(ownerParty, amountCc, seconds);
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'lock gagal' };
    }

    // Metadata di cc_locks (sumber kebenaran jumlah tetap on-chain; tabel = metadata + UI)
    const lockedAt = new Date();
    const expiresAt = new Date(lockedAt.getTime() + seconds * 1000);
    let lockRow: { id: string } | null = null;
    try {
      lockRow = await this.prisma.ccLock.create({
        data: {
          ownerParty,
          userId: user.id,
          amountCc,
          termKey: body.termKey,
          lockSeconds: seconds,
          lockedAt,
          expiresAt,
          status: 'LOCKED',
          lockedAmuletCid: result.lockedAmuletCid ?? null,
        },
      });
    } catch (err) {
      // Lock inti SUDAH sukses on-chain (LockedAmulet mendarat). Kegagalan tulis
      // baris metadata DB TIDAK boleh membatalkan lock. Reconciler di lock-status
      // akan backfill baris dari chain (match by lockedAmuletCid) sehingga lock
      // tetap muncul di UI & unlockable.
      this.logger.error(
        `lockCc: on-chain sukses tapi ccLock.create gagal user=${user.id.slice(0, 8)} ` +
          `cid=${(result.lockedAmuletCid ?? '?').slice(0, 16)}… : ${String(err)} — reconcile akan backfill.`,
      );
    }

    // Catat ke history transaksi (tampilan). Idempotensi via @@unique(userId, ledgerTxId):
    // ledgerTxId = lockedAmuletCid → handler ulang tidak akan mendobel-catat.
    if (result.lockedAmuletCid) {
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc,
          type: 'CC_LOCK',
          description: 'CC Locked',
          referenceId: lockRow?.id,
          // ledgerTxId = updateId transaksi (untuk link explorer Lighthouse);
          // fallback ke lockedAmuletCid bila updateId tidak tersedia.
          ledgerTxId: result.updateId ?? result.lockedAmuletCid,
          cantonUpdateId: result.lockedAmuletCid,
        });
      } catch (err) {
        // P2002 = sudah ada (idempoten). Selain itu: non-fatal — lock inti tetap sukses.
        this.logger.warn(`CC_LOCK history record failed: ${String(err)}`);
      }
    }

    return {
      ok: true,
      expiresAt,
      lockId: lockRow?.id,
      lockedAmuletCid: result.lockedAmuletCid ?? null,
    };
  }

  /**
   * POST /party/unlock — unlock satu lock (lockId) atau yang expiresAt<=now paling awal.
   * Memakai cantonLedgerService.unlockCc() (LockedAmulet_OwnerExpireLockV2 per catatan MD).
   */
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  @Post('unlock')
  async unlockCc(@Req() req: AuthedReq, @Body() body: UnlockCcDto) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    // Gate kata sandi transaksi (opsional): wajib hanya bila user telah menetapkan satu.
    await this.walletPassword.assertGate(user.id, body.walletPassword);
    const ownerParty = user.cantonPartyId;

    // Pilih lock: by lockId, else expired paling awal milik user.
    let lock = null as null | {
      id: string;
      lockedAmuletCid: string | null;
      expiresAt: Date;
      amountCc: any;
    };
    if (body.lockId?.trim()) {
      lock = await this.prisma.ccLock.findFirst({
        where: { id: body.lockId.trim(), ownerParty, status: 'LOCKED' },
      });
      if (!lock)
        throw new BadRequestException(
          'Lock tidak ditemukan atau sudah tidak aktif.',
        );
    } else {
      const now = new Date();
      lock = await this.prisma.ccLock.findFirst({
        where: { ownerParty, status: 'LOCKED', expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
      });
      if (!lock) {
        throw new BadRequestException(
          'Tidak ada lock yang siap di-unlock saat ini.',
        );
      }
    }

    // Guard backend (ledger juga menolak; ini untuk pesan rapi).
    if (lock.expiresAt.getTime() > Date.now()) {
      const tanggal = lock.expiresAt.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      throw new BadRequestException(`Belum bisa unlock sampai ${tanggal}.`);
    }

    this.logger.log(
      `unlockCc: user=@${user.username} lockId=${lock.id} cid=${(lock.lockedAmuletCid ?? '?').slice(0, 16)}…`,
    );

    const result = await this.ledger.unlockCc(
      ownerParty,
      lock.lockedAmuletCid ?? undefined,
    );
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'unlock failed' };
    }

    await this.prisma.ccLock.update({
      where: { id: lock.id },
      data: { status: 'UNLOCKED', unlockedAt: new Date() },
    });

    // Catat ke history transaksi (tampilan). Idempotensi via @@unique(userId, ledgerTxId):
    // pakai updateId ASLI dari exercise (link Lighthouse benar). Fallback ke amulet cid
    // baru bila updateId tidak tersedia (kasus ambiguous-recovery). Relasi ke lock asli
    // disimpan di cantonUpdateId + referenceId (lock.id).
    const unlockLedgerTxId =
      result.updateId ??
      (result.unlockedCid
        ? `unlock:${result.unlockedCid}`
        : lock.lockedAmuletCid
          ? `unlock:${lock.lockedAmuletCid}`
          : `unlock:${lock.id}`);
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: Number(lock.amountCc),
        type: 'CC_UNLOCK',
        description: 'CC Unlocked',
        referenceId: lock.id,
        ledgerTxId: unlockLedgerTxId,
        cantonUpdateId: lock.lockedAmuletCid ?? undefined,
      });
    } catch (err) {
      // P2002 = sudah ada (idempoten). Selain itu: non-fatal — unlock inti tetap sukses.
      this.logger.warn(`CC_UNLOCK history record failed: ${String(err)}`);
    }

    return { ok: true, lockId: lock.id };
  }

  // ── Kata sandi transaksi (wallet password) — manajemen di Settings ────────

  /** GET /party/wallet-password — apakah user telah menetapkan wallet password? */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('wallet-password')
  async getWalletPassword(@Req() req: AuthedReq) {
    const hasPassword = await this.walletPassword.hasPassword(req.user.userId);
    return { hasPassword };
  }

  /**
   * POST /party/wallet-password — set atau ganti wallet password.
   * - Bila belum punya: set baru (currentPassword diabaikan).
   * - Bila sudah punya: wajib currentPassword benar.
   */
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('wallet-password')
  async setWalletPassword(
    @Req() req: AuthedReq,
    @Body() body: SetWalletPasswordDto,
  ) {
    const has = await this.walletPassword.hasPassword(req.user.userId);
    await this.walletPassword.changePassword(
      req.user.userId,
      body.newPassword,
      body.currentPassword,
    );
    this.logger.log(
      `wallet password ${has ? 'changed' : 'set'}: user=${req.user.userId.slice(0, 8)}`,
    );
    return { ok: true, hasPassword: true };
  }

  /**
   * DELETE /party/wallet-password — hapus wallet password (menonaktifkan gate).
   * Wajib verifikasi currentPassword terlebih dahulu.
   */
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Delete('wallet-password')
  async removeWalletPassword(
    @Req() req: AuthedReq,
    @Body() body: RemoveWalletPasswordDto,
  ) {
    await this.walletPassword.clearPassword(
      req.user.userId,
      body.currentPassword,
    );
    this.logger.log(
      `wallet password removed: user=${req.user.userId.slice(0, 8)}`,
    );
    return { ok: true, hasPassword: false };
  }

  /**
   * GET /party/lock-terms — daftar pilihan term dari LOCK_TERM_OPTIONS.
   * UI render tombol durasi dari sini (BUKAN hard-code 7/15/30).
   */
  @SkipThrottle()
  @Get('lock-terms')
  async lockTerms() {
    const { options } = this.getLockTerms();
    return { terms: options };
  }

  /**
   * GET /party/lock-status — status lock user.
   * lockedCc dari on-chain (lockEligibility.lockedCcOf); activeLocks dari cc_locks.
   * Countdown DIHITUNG DI FRONTEND dari expiresAt.
   *
   * RECONCILE: sebelum query activeLocks, selaraskan dulu tabel cc_locks dengan
   * LockedAmulet on-chain. Ini menutup celah "lock sukses di chain tapi row DB
   * gagal dibuat" (mis. frontend error setelah tx on-chain sukses) → CC tetap
   * terkunci di chain tapi TIDAK muncul di UI → user tidak bisa unlock. Dengan
   * reconcile, orphan LockedAmulet di-backfill jadi baris LOCKED sehingga muncul
   * di activeLocks[] dan jadi unlockable. Idempoten & best-effort (non-fatal).
   */
  @SkipThrottle()
  @Get('lock-status')
  async lockStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      return {
        lockedCc: 0,
        availableCc: null,
        tier: 'NONE' as const,
        activeLocks: [],
        hasWallet: false,
      };
    }
    const ownerParty = user.cantonPartyId;

    // ── Reconcile: backfill orphan LockedAmulet (lock on-chain, DB row hilang) ──
    try {
      const backfilled = await this.lockEligibility.reconcileLocksWithChain(
        ownerParty,
        user.id,
      );
      if (backfilled > 0) {
        this.logger.log(
          `lock-status reconcile: backfilled ${backfilled} orphan lock(s) for user=${user.id.slice(0, 8)}`,
        );
      }
    } catch (err) {
      // Non-fatal: status tetap dikembalikan (hanya reconcile yang skip).
      this.logger.warn(`lock-status reconcile failed: ${String(err)}`);
    }

    const [lockedCc, tier, activeLocks, balanceRow] = await Promise.all([
      this.lockEligibility.lockedCcOf(ownerParty),
      this.lockEligibility.tierOf(ownerParty),
      this.prisma.ccLock.findMany({
        where: { ownerParty, status: 'LOCKED' },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.ccBalance.findUnique({
        where: { userId: user.id },
        select: { balanceMicroCc: true },
      }),
    ]);

    // availableCc opsional (untuk tombol MAX di modal). Dari snapshot DB balance.
    const availableCc = balanceRow
      ? Number(balanceRow.balanceMicroCc) / 1_000_000
      : null;

    return {
      lockedCc,
      availableCc,
      tier,
      activeLocks: activeLocks.map((l) => ({
        id: l.id,
        amountCc: Number(l.amountCc),
        termKey: l.termKey,
        lockSeconds: l.lockSeconds,
        expiresAt: l.expiresAt.toISOString(),
        lockedAmuletCid: l.lockedAmuletCid,
      })),
      hasWallet: true,
    };
  }

  @SkipThrottle()
  @Get('ledger-status')
  async ledgerStatus() {
    const [canton, splice] = await Promise.all([
      this.ledger.isReachable(),
      this.splice.isReachable(),
    ]);
    return {
      canton: { reachable: canton },
      splice: { reachable: splice, configured: this.splice.isConfigured },
      message:
        canton && splice
          ? 'Node connected.'
          : !canton
            ? 'Node connection issue'
            : 'Node connection issue',
    };
  }
}
