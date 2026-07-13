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
  ServiceUnavailableException,
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
import { CantexClient } from '../cantex/cantex-client';
import { CantexPriceFeedService } from '../cantex/cantex-price-feed.service';
import { SwapService } from '../cantex/swap.service';
import { isCantexEnabled } from '../cantex/cantex.config';
import { CantexError } from '../cantex/cantex.types';
import { UsersService } from '../users/users.service';
import { WalletPasswordService } from "../users/wallet-password.service";
import { feePartyLabels } from '../users/cc-transaction-visibility';
import { WalletInviteCodeService } from './wallet-invite-code.service';
import { AllocateWalletDto } from './dto/allocate-wallet.dto';
import { CantonPartyBindingDto } from './dto/canton-party-binding.dto';
import { SendCcDto } from './dto/send-cc.dto';
import { SendTokenDto } from './dto/send-token.dto';
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
import { SwapQuoteDto } from './dto/swap-quote.dto';
import { SwapDto } from './dto/swap.dto';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyController {
  private readonly logger = new Logger(PartyController.name);

  /**
   * In-memory mutex per-user untuk sendCc. Mencegah dua request konkuren
   * (multi-tab / double-click cepat / scripted client) lewati balance check
   * bersamaan lalu submit dua transfer. Request kedua yang masuk saat user
   * masih punya transfer in-flight langsung ditolak 409.
   * NOTE: scoped per-process — cukup untuk single-instance API. Kalau API
   * di-scale multi-instance, ganti ke Redis SET NX.
   */
  private readonly sendCcInFlight = new Set<string>();

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
    private readonly cantex: CantexClient,
    private readonly cantexPrices: CantexPriceFeedService,
    private readonly swapService: SwapService,
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

    // Per-user mutex (Fix fund-safety #2): cegah dua transfer konkuren dari user
    // yang sama (multi-tab / double-click cepat / scripted client dengan nonce
    // beda). Tanpa ini, dua request bisa lewati balance check bersamaan lalu
    // submit dua transfer → overdraft. commandId dedup (Fix #1) hanya cover
    // nonce sama; lock ini cover nonce beda. try/finally menjamin release di
    // SEMUA jalur keluar (throw, return, crash).
    if (this.sendCcInFlight.has(sender.id)) {
      throw new ConflictException(
        'You have a transfer in progress. Please wait for it to complete.',
      );
    }
    this.sendCcInFlight.add(sender.id);
    try {
      // DTO (SendCcDto) already enforces: number, > 0, ≤ MAX_TRANSFER_CC, finite.
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Amount must be greater than 0.');
      }

      const feeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '5',
      );
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
        clientNonce: body.clientNonce, // dedup ledger — double-click jadi 1 transfer
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
          // ledgerTxId = Canton update_id ("1220…") supaya link explorer jalan.
          // contract_id (transferInstructionCid) disimpan di field terpisah di row.
          ledgerTxId = cip56Result.updateId ?? undefined;
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
                cantonUpdateId: feeLedgerTxId,
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
                  cantonUpdateId: feeLedgerTxId,
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
        // Fund-safety #4: ledger SUDAH sukses (CC sudah keluar on-chain). Kalau
        // recordTransaction throw (DB down), CC pergi tanpa audit trail. Bungkus
        // agar: (a) tidak throw ke user seolah transfer gagal — transfer NYATA
        // berhasil; (b) log ALERT kuat + data lengkap supaya bisa reconcile manual;
        // (c) balance self-heal via cc-inbound-sync (≤30s). History row hilang =
        // reconcile manual dari log ini + ledgerTxId.
        try {
          const outRow = await this.users.recordTransaction({
            userId: sender.id,
            amountCc: amount,
            type: 'TRANSFER_OUT',
            description,
            counterparty: recipientPartyId,
            // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") supaya link
            // explorer langsung jalan tanpa lazy-fill.
            ledgerTxId: ledgerTxId,
            cantonUpdateId: ledgerTxId,
          });
          transferTransactionId = outRow.id;
          if (ledgerTxId && sender.cantonPartyId) {
            void this.txDetail.backfillUpdateId(
              outRow.id,
              ledgerTxId,
              sender.cantonPartyId,
            );
          }
        } catch (err) {
          this.logger.error(
            `⚠️ AUDIT-TRAIL LOSS: ledger transfer SUCCEEDED but DB record failed. ` +
              `sender=${sender.id} @${sender.username} amount=${amount} CC ` +
              `recipient=${recipientLabel} ledgerTxId=${ledgerTxId ?? 'n/a'}. ` +
              `CC LEFT on-chain; balance will self-heal via sync. HISTORY ROW MISSING — ` +
              `reconcile manually from this log. Error: ${String(err)}`,
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
          try {
            await this.users.recordTransaction({
              userId: recipientDbUser.id,
              amountCc: amount,
              type: 'TRANSFER_IN',
              description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
              counterparty:
                normalizeCantonPartyId(sender.cantonPartyId) ??
                sender.cantonPartyId,
              // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") — update
              // yang sama dengan row sender (satu transfer = satu ledger update).
              ledgerTxId: ledgerTxId,
              cantonUpdateId: ledgerTxId,
            });
          } catch (err) {
            // Recipient row hilang kurang kritis — recipient balance self-heal
            // via sync INCREASE branch. Tetap log supaya reconcile-aware.
            this.logger.warn(
              `Recipient TRANSFER_IN row failed (will self-heal via sync): ` +
                `recipient=${recipientDbUser.id} ledgerTxId=${ledgerTxId ?? 'n/a'}: ${String(err)}`,
            );
          }
          if (recipientDbUser.username) {
            void this.inboundSync.alignBalanceFromChain(
              recipientDbUser.id,
              recipientDbUser.username,
            );
          }
        }
        if (sender.username) {
          void this.inboundSync.alignBalanceFromChain(
            sender.id,
            sender.username,
          );
        }
      }

      // ── Offer-only: return pending status (not an error) ─────────────────
      if (transferMethod === 'offer_only') {
        // Fund-safety #4: offer SUDAH dibuat on-chain. Bungkus DB write supaya
        // kegagalan tidak tampak sebagai "transfer gagal" (offer nyata terbuat).
        let pendingRowId: string | undefined;
        try {
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
          pendingRowId = pendingRow.id;
        } catch (err) {
          this.logger.error(
            `⚠️ AUDIT-TRAIL LOSS (offer): offer SUCCEEDED but DB record failed. ` +
              `sender=${sender.id} @${sender.username} amount=${amount} CC ` +
              `recipient=${recipientLabel} ledgerTxId=${ledgerTxId ?? 'n/a'} ` +
              `instructionCid=${cip56Result.transferInstructionCid ?? 'n/a'}. ` +
              `Reconcile manually. Error: ${String(err)}`,
          );
        }
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
          transactionId: pendingRowId,
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
    } finally {
      // Fund-safety #2: wajib release lock di SEMUA jalur keluar (return/throw).
      this.sendCcInFlight.delete(sender.id);
    }
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
      // Preferensi Canton update_id ("1220…") untuk link explorer; fallback
      // contract_id (cid) bila ledger response tidak ter-parse.
      ledgerTxId: result.updateId ?? cid,
      cantonUpdateId: result.updateId ?? undefined,
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

    // Resolve instrument SEBELUM reject punya masalah (offer hilang setelah reject,
    // tapi rejectTransferInstruction sudah terlanjur exercise di atas — lookup mungkin
    // null, fallback default CC). Branch: non-CC → TokenTransaction, CC → CcTransaction.
    let rejectInstrumentId = 'Amulet';
    let rejectInstrumentAdmin = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        cid,
        user.cantonPartyId,
      );
      if (detail) {
        rejectInstrumentId = detail.instrumentId || 'Amulet';
        rejectInstrumentAdmin = detail.instrumentAdmin || '';
      }
    } catch {
      /* offer sudah hilang post-exercise — default CC */
    }
    const rejectIsNonCc = rejectInstrumentId.toLowerCase() !== 'amulet';

    // Catat history (tx id ASLI dari exercise). Non-fatal: onchain reject tetap
    // sukses walau pencatatan gagal — gap "terkirim tapi history gagal" dihindari.
    try {
      if (rejectIsNonCc) {
        await this.users.recordTokenTransaction({
          userId: user.id,
          instrumentId: rejectInstrumentId,
          instrumentAdmin: rejectInstrumentAdmin,
          amount: 0,
          type: 'TOKEN_OFFER_REJECTED',
          description: `Rejected incoming ${rejectInstrumentId} transfer`,
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      } else {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0,
          type: 'OFFER_REJECTED',
          description: 'Rejected incoming CC transfer',
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      }
    } catch (err) {
      this.logger.warn(
        `OFFER_REJECTED history record failed (cid=${cid.slice(0, 16)}): ${String(err)}`,
      );
    }

    return {
      ok: true,
      updateId: result.updateId,
      message: rejectIsNonCc
        ? `Transfer rejected. ${rejectInstrumentId} returned to sender.`
        : 'Transfer rejected. CC returned to sender.',
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

    // Resolve instrument (offer sudah hilang post-exercise — lookup mungkin null,
    // fallback default CC). Branch: non-CC → TokenTransaction, CC → CcTransaction.
    let withdrawInstrumentId = 'Amulet';
    let withdrawInstrumentAdmin = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        cid,
        user.cantonPartyId,
      );
      if (detail) {
        withdrawInstrumentId = detail.instrumentId || 'Amulet';
        withdrawInstrumentAdmin = detail.instrumentAdmin || '';
      }
    } catch {
      /* offer sudah hilang post-exercise — default CC */
    }
    const withdrawIsNonCc = withdrawInstrumentId.toLowerCase() !== 'amulet';

    // Catat history (tx id ASLI dari exercise). Non-fatal.
    try {
      if (withdrawIsNonCc) {
        await this.users.recordTokenTransaction({
          userId: user.id,
          instrumentId: withdrawInstrumentId,
          instrumentAdmin: withdrawInstrumentAdmin,
          amount: 0,
          type: 'TOKEN_OFFER_WITHDRAWN',
          description: `Cancelled outgoing ${withdrawInstrumentId} transfer`,
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      } else {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0,
          type: 'OFFER_WITHDRAWN',
          description: 'Cancelled outgoing CC transfer',
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      }
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
      message: withdrawIsNonCc
        ? `Transfer cancelled. ${withdrawInstrumentId} returned to your wallet.`
        : 'Transfer cancelled. CC returned to your wallet.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // P2P Token Transfer (non-CC) — CIP-0056 on-chain two-step
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /party/send-token — kirim token non-CC (USDCx, dll) ke user lain via
   * CIP-0056 on-chain two-step. Token CC (Amulet) HARUS pakai /send-cc.
   *
   * Berbeda dari CC, token non-CC tidak ada TransferPreapproval → transferKind
   * hampir pasti "offer": TransferInstruction UTXO dibuat, receiver harus klik
   * Accept via /party/offers/accept. Holdings sender ON-CHAIN langsung ter-consume.
   *
   * Sumber kebenaran saldo = ON-CHAIN (queryTokenHoldings), BUKAN CantexTokenBalance
   * (DB) yang bisa drift (swap selalu kredit DB walau on-chain gagal).
   *
   * Fee in CC (reuse TRANSACTION_FEE_CC) — non-blocking, mirror sendCc.
   */
  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('send-token')
  async sendToken(@Req() req: AuthedReq, @Body() body: SendTokenDto) {
    const sender = await this.users.findById(req.user.userId);
    if (!sender?.username || !sender.cantonPartyId) {
      throw new BadRequestException(
        'You need a wallet to send tokens. Create yours first.',
      );
    }
    if (!hasRealWallet(sender.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Wallet password gate (opsional, mirror sendCc).
    await this.walletPassword.assertGate(sender.id, body.walletPassword);

    // Per-user mutex: cegah dua transfer konkuren dari user yang sama
    // (multi-tab / double-click / nonce beda). Reuse sendCcInFlight supaya user
    // tidak bisa kirim CC + token konkuren sekaligus.
    if (this.sendCcInFlight.has(sender.id)) {
      throw new ConflictException(
        'You have a transfer in progress. Please wait for it to complete.',
      );
    }
    this.sendCcInFlight.add(sender.id);
    try {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Amount must be greater than 0.');
      }

      // CC tidak boleh lewat sini — CC pakai /send-cc (preapproval, fee path CC).
      const instrumentId = body.instrumentId.trim();
      const instrumentAdmin = body.instrumentAdmin.trim();
      if (instrumentId.toLowerCase() === 'amulet') {
        throw new BadRequestException(
          'Use /send-cc for Canton Coin (CC) transfers.',
        );
      }
      if (!instrumentId || !instrumentAdmin) {
        throw new BadRequestException(
          'instrumentId and instrumentAdmin are required for token transfer.',
        );
      }

      // ── Resolve recipient (username atau party id) — mirror sendCc ────
      const recipientInput = body.recipientUsername?.trim();
      if (!recipientInput) {
        throw new BadRequestException('Recipient is required.');
      }

      let recipientPartyId: string;
      let recipientLabel: string;

      if (looksLikeCantonPartyId(recipientInput)) {
        const normalizedRecipient = normalizeCantonPartyId(recipientInput);
        if (!normalizedRecipient) {
          throw new BadRequestException('Invalid Party ID format.');
        }
        if (cantonPartyIdsEqual(normalizedRecipient, sender.cantonPartyId)) {
          throw new BadRequestException('You cannot send tokens to yourself.');
        }
        if (this.isSystemPartyId(normalizedRecipient)) {
          this.logger.warn(
            `Blocked send-token to system party: user=${sender.id.slice(0, 8)} target=${normalizedRecipient.split('::')[0]} amount=${amount} ${instrumentId}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        recipientPartyId = normalizedRecipient;
        recipientLabel =
          normalizedRecipient.split('::')[0] ?? normalizedRecipient;
      } else {
        const username = recipientInput.replace(/^@/, '').toLowerCase();
        if (username === sender.username?.toLowerCase()) {
          throw new BadRequestException('You cannot send tokens to yourself.');
        }
        const dbUser = await this.users.findByUsernameInsensitive(username);
        const resolved =
          dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
        if (!resolved) {
          throw new BadRequestException(
            `User "@${username}" not found or has no wallet.`,
          );
        }
        // VALIDATE: recipient must have a REAL Canton wallet (not placeholder).
        // Placeholder party (canquest::...) tidak terdaftar di Canton Network
        // synchronizer → transfer akan gagal dengan UNKNOWN_INFORMEES.
        if (!hasRealWallet(resolved)) {
          throw new BadRequestException(
            `User "@${username}" has no Canton wallet yet. ` +
              'They need to create a wallet first to receive tokens.',
          );
        }
        recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
        if (this.isSystemPartyId(recipientPartyId)) {
          this.logger.warn(
            `Blocked send-token to system wallet via @${username}: user=${sender.id.slice(0, 8)} amount=${amount} ${instrumentId}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        recipientLabel = `@${username}`;
      }

      const description =
        body.memo?.trim() ||
        `Sent ${amount} ${instrumentId} to ${recipientLabel}`;

      // ── Balance pre-check ON-CHAIN (sumber kebenaran untuk token non-CC) ──
      // CantexTokenBalance (DB) bisa drift (swap kredit DB walau on-chain gagal)
      // → jangan dipakai untuk validate send-token. queryTokenHoldings membaca
      // ACS on-chain: sum amount holdings sender untuk (instrumentId, admin).
      let onChainBalance = 0;
      try {
        const holdings = await this.ledger.queryTokenHoldings(
          sender.cantonPartyId,
          instrumentId,
          instrumentAdmin,
        );
        onChainBalance = holdings.reduce(
          (sum, h) => sum + Number(h.amount || 0),
          0,
        );
      } catch (err) {
        this.logger.warn(
          `queryTokenHoldings failed for send-token pre-check: ${String(err)} — proceeding (ledger akan reject bila dana kurang)`,
        );
      }

      const feeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '5',
      );

      if (onChainBalance > 0 && onChainBalance < amount) {
        throw new BadRequestException(
          `Insufficient on-chain ${instrumentId} balance. Need ${amount}, have ${onChainBalance.toFixed(6)}.`,
        );
      }

      // CC fee pre-check (DB cache — fast path). Fee in CC, jadi sender butuh CC.
      if (feeCc > 0) {
        const dbCcBal = await this.prisma.ccBalance.findUnique({
          where: { userId: sender.id },
          select: { balanceMicroCc: true },
        });
        const cachedCc = dbCcBal
          ? Number(dbCcBal.balanceMicroCc) / 1_000_000
          : 0;
        if (cachedCc < feeCc) {
          throw new BadRequestException(
            `Insufficient CC for fee. Need ${feeCc} CC (platform fee for token transfer).`,
          );
        }
      }

      // ── MAIN TRANSFER via CIP-0056 (on-chain, two-step) ───────────────
      this.logger.log(
        `send-token: ${sender.username} → ${recipientLabel} ${amount} ${instrumentId} ` +
          `(admin=${instrumentAdmin.slice(0, 12)}...) nonce=${body.clientNonce.slice(0, 8)}`,
      );

      const cip56Result = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId: sender.cantonPartyId,
        receiverPartyId: recipientPartyId,
        amountCc: amount,
        description,
        clientNonce: body.clientNonce,
        instrumentId,
        instrumentAdmin,
      });

      if (!cip56Result.ok) {
        throw new BadRequestException(
          `Token transfer failed: ${cip56Result.error?.slice(0, 160) ?? 'unknown error'}`,
        );
      }

      const ledgerTxId = cip56Result.updateId ?? undefined;
      const transferInstructionCid =
        cip56Result.transferInstructionCid ?? undefined;

      // Untuk non-CC, transferKind hampir pasti "offer" (no preapproval).
      // Offer dibuat = transfer utama SUDAH submitted on-chain → fee applicable.
      const submitted =
        cip56Result.transferKind === 'offer' ||
        cip56Result.transferKind === 'direct';

      this.logger.log(
        `send-token OK: ${sender.username} → ${recipientLabel} ${amount} ${instrumentId} ` +
          `kind=${cip56Result.transferKind}` +
          (transferInstructionCid
            ? ` instructionCid=${transferInstructionCid.slice(0, 16)}...`
            : '') +
          ` — recipient must accept via Offers menu`,
      );

      // ── Record history (TokenTransaction, instrument-aware) ───────────
      let transactionId: string | undefined;
      try {
        const row = await this.users.recordTokenTransaction({
          userId: sender.id,
          instrumentId,
          instrumentAdmin,
          amount,
          type: 'TOKEN_TRANSFER_OUT',
          description,
          referenceId: `to:${normalizeCantonPartyId(recipientPartyId) ?? recipientPartyId}`,
          ledgerTxId: ledgerTxId ?? transferInstructionCid,
          cantonUpdateId: ledgerTxId ?? undefined,
          status: 'PENDING', // offer belum di-accept receiver
          transferInstructionCid: transferInstructionCid ?? null,
        });
        transactionId = row.id;
      } catch (err) {
        this.logger.warn(
          `TOKEN_TRANSFER_OUT history record failed: ${String(err)}`,
        );
      }

      // ── FEE COLLECT (CC, non-blocking, mirror sendCc) ─────────────────
      let feeCollected = false;
      if (feeCc > 0 && submitted) {
        const validatorPartyId =
          this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';
        const feeParty =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
          validatorPartyId;
        if (feeParty) {
          try {
            const feeResult = await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: sender.cantonPartyId,
              receiverPartyId: feeParty,
              amountCc: feeCc,
              description: `Platform fee: ${recipientLabel} (${instrumentId})`,
            });
            if (feeResult.ok && feeResult.transferKind === 'direct') {
              feeCollected = true;
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: feeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (token transfer to ${recipientLabel})`,
                referenceId: `fee:${normalizeCantonPartyId(feeParty) ?? feeParty}`,
                ledgerTxId: feeResult.updateId ?? undefined,
                cantonUpdateId: feeResult.updateId ?? undefined,
              });
            } else if (
              feeResult.ok &&
              feeResult.transferKind === 'offer' &&
              feeResult.transferInstructionCid
            ) {
              // Fee offer perlu di-accept oleh fee party (auto, mirror sendCc:836).
              const acceptR = await this.ledger.acceptTransferInstruction(
                feeResult.transferInstructionCid,
                feeParty,
              );
              if (acceptR.ok) {
                feeCollected = true;
                await this.users.recordTransaction({
                  userId: sender.id,
                  amountCc: feeCc,
                  type: 'TRANSFER_OUT',
                  description: `Platform fee (token transfer to ${recipientLabel})`,
                  referenceId: `fee:${normalizeCantonPartyId(feeParty) ?? feeParty}`,
                  ledgerTxId:
                    acceptR.updateId ?? feeResult.updateId ?? undefined,
                  cantonUpdateId:
                    acceptR.updateId ?? feeResult.updateId ?? undefined,
                });
              } else {
                this.logger.warn(
                  `Fee offer accept failed (token transfer): transfer proceeds without fee`,
                );
              }
            }
          } catch (feeErr) {
            this.logger.warn(
              `Fee collect error (token transfer, non-blocking): ${String(feeErr)}`,
            );
          }
        }
      }

      return {
        ok: true,
        success: true,
        instrumentId,
        amount,
        from: sender.username,
        to: recipientLabel,
        fee: feeCc,
        feeCollected,
        transferKind: cip56Result.transferKind,
        transferInstructionCid,
        offerPending: cip56Result.transferKind === 'offer',
        transactionId,
        message:
          cip56Result.transferKind === 'offer'
            ? `Sent ${amount} ${instrumentId} to ${recipientLabel}. Recipient must accept via Offers menu. Offer ID: ${transferInstructionCid?.slice(0, 20) ?? ledgerTxId?.slice(0, 20) ?? '?'}…`
            : `Sent ${amount} ${instrumentId} to ${recipientLabel}.`,
      };
    } finally {
      // Fund-safety: wajib release lock di SEMUA jalur keluar.
      this.sendCcInFlight.delete(sender.id);
    }
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
          // Splice fallback tidak expose instrument → default CC.
          instrumentId: 'Amulet',
          instrumentAdmin: '',
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
    // amount + sender + instrument ini dipakai untuk catat history yang truthful.
    let amountCc = 0;
    let senderLabel = '';
    let offerInstrumentId = 'Amulet';
    let offerInstrumentAdmin = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(
        cid,
        user.cantonPartyId,
      );
      if (detail) {
        amountCc = parseFloat(detail.amount) || 0;
        senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        offerInstrumentId = detail.instrumentId || 'Amulet';
        offerInstrumentAdmin = detail.instrumentAdmin || '';
      }
    } catch (err) {
      this.logger.warn(`lookupOfferDetail (accept) failed: ${String(err)}`);
    }
    const isNonCcToken = offerInstrumentId.toLowerCase() !== 'amulet';

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
        updateId ?? undefined,
      );
    } catch (err) {
      this.logger.warn(`markTransferInstructionSettled failed: ${String(err)}`);
    }

    if (settledOwnReward === 0) {
      // (legacy branch) Reward pending kita TIDAK ditemukan → lanjut catat
      // TRANSFER_IN untuk penerima di bawah.
    }

    // ── PENERIMA selalu dapat history saat accept (Fix UX) ──────────────
    // Branch: token non-CC → TokenTransaction (instrument-aware); CC → CcTransaction.
    {
      if (isNonCcToken) {
        // Token non-CC: catat ke TokenTransaction. amount = amountCc (decimal,
        // bukan micro). CC balance delta tidak relevan — lewati resolve-delta.
        const kindLabel =
          offerType === OfferType.TRANSFER_INSTRUCTION ? 'CIP-0056' : 'legacy';
        try {
          await this.users.recordTokenTransaction({
            userId: user.id,
            instrumentId: offerInstrumentId,
            instrumentAdmin: offerInstrumentAdmin,
            amount: amountCc,
            type: 'TOKEN_TRANSFER_IN',
            description:
              amountCc > 0
                ? `Received ${amountCc} ${offerInstrumentId}${senderLabel ? ` from ${senderLabel}` : ''}`
                : `Accepted incoming ${kindLabel} ${offerInstrumentId} transfer`,
            referenceId: senderLabel || undefined,
            ledgerTxId: updateId ?? cid,
            cantonUpdateId: updateId ?? undefined,
          });
        } catch (err) {
          // P2002 = idempotent retry → OK. Error lain = audit loss (non-fatal).
          this.logger.warn(
            `Recipient TOKEN_TRANSFER_IN on accept failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
          );
        }
      } else {
        // CC: jalur lama — resolve amount via delta balance on-chain kalau 0.
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
        try {
          await this.users.recordTransaction({
            userId: user.id,
            amountCc: resolvedAmount,
            type: 'TRANSFER_IN',
            description:
              resolvedAmount > 0
                ? `Received ${resolvedAmount} CC${senderLabel ? ` from ${senderLabel}` : ''}`
                : `Accepted incoming ${kindLabel} transfer`,
            counterparty: senderLabel || undefined,
            // Preferensi Canton update_id ("1220…") untuk link explorer; fallback
            // contract_id (cid) bila ledger response tidak ter-parse.
            ledgerTxId: updateId ?? cid,
            cantonUpdateId: updateId ?? undefined,
          });
        } catch (err) {
          // Unique constraint (P2002) = row sudah ada (idempotent retry) → OK.
          // Error lain = audit-trail loss untuk penerima; balance self-heal via sync.
          this.logger.warn(
            `Recipient TRANSFER_IN on accept failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
          );
        }
      }
    }

    if (user.username) {
      // CC balance self-heal (token non-CC tidak terpengaruh — aman dipanggil).
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId,
      message: isNonCcToken
        ? `Transfer accepted. ${offerInstrumentId} will appear in your wallet shortly.`
        : 'Transfer accepted. CC will appear in your wallet shortly.',
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
      // yang ditolak → catat jejak OFFER_REJECTED (amount 0) supaya user punya
      // riwayatnya. Konsisten dengan legacy branch di bawah dan rejectTransferInstruction.
      let settledOwnReward = 0;
      try {
        settledOwnReward = await this.users.markTransferInstructionSettled(
          cid,
          'REJECTED',
          result.updateId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED failed: ${String(err)}`,
        );
      }
      // ── PENERIMA selalu dapat history OFFER_REJECTED saat reject (Fix UX) ──
      // Sebelumnya: recordTransaction OFFER_REJECTED hanya jalan kalau
      // settledOwnReward === 0. Tapi markTransferInstructionSettled match row
      // PENDING global (milik SENDER) → return >0 → blok di-skip → PENERIMA
      // tidak dapat history reject. Cegah double via unique constraint
      // @@unique([userId, ledgerTxId]), bukan via settledOwnReward.
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'OFFER_REJECTED',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      } catch (err) {
        this.logger.warn(
          `Recipient OFFER_REJECTED on reject failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
        );
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
          result.updateId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED (legacy) failed: ${String(err)}`,
        );
      }
      // ── PENERIMA selalu dapat history OFFER_REJECTED saat reject (Fix UX) ──
      // Sebelumnya: recordTransaction OFFER_REJECTED hanya jalan kalau
      // settledOwnReward === 0. Tapi markTransferInstructionSettled match row
      // PENDING global (milik SENDER) → return >0 → blok di-skip → PENERIMA
      // tidak dapat history reject. Cegah double via unique constraint
      // @@unique([userId, ledgerTxId]), bukan via settledOwnReward.
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'OFFER_REJECTED',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      } catch (err) {
        this.logger.warn(
          `Recipient OFFER_REJECTED on reject failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
        );
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
        // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") untuk link explorer.
        // transferPreapprovalCid (contract_id) tidak disimpan di kolom tx — biarkan null
        // bila updateId tidak ada; link disembunyikan (bukan contract_id yang menyesatkan).
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
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
    // tetap sukses walau pencatatan gagal. Bila updateId tidak tersedia (e.g. lewat
    // Splice fallback path), ledgerTxId null — link explorer disembunyikan (bukan
    // marker palsu). NULL ledgerTxId aman: unique constraint Postgres mengizinkan
    // beberapa row NULL untuk userId yang sama.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'PREAPPROVAL_DISABLED',
        description: 'Preapproval disabled — manual accept required',
        referenceId: user.cantonPartyId,
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
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
   * Onchain transactions from the Modo Transfer API for the user's party.
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

    // Fail-soft: kalau Modo belum dikonfigurasi (MODO_API_KEY hilang), jangan
    // throw — kembalikan list kosong supaya UI wallet tetap render.
    if (!this.modo.isConfigured()) {
      this.logger.warn(
        'Modo onchain fetch skipped — MODO_API_URL/MODO_API_KEY not set',
      );
      return { transactions: [], pagination: null };
    }

    const size = Math.min(100, Math.max(1, parseInt(limit ?? '15', 10) || 15));

    try {
      const result = await this.modo.getTransfersByParty(partyId, {
        size,
        role: 'ANY',
        sortBy: 'AGE',
        cursor: cursor || undefined,
      });
      if (!result) {
        this.logger.warn(
          'Modo onchain fetch returned no result (upstream error)',
        );
        return { transactions: [], pagination: null };
      }

      // Network fee fallback (CC) — dipakai HANYA bila item.fee tidak ada di
      // response Modo. Sourced from TRANSACTION_FEE_CC env (default 0.2 CC).
      const fallbackFeeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '0.2',
      );
      const fallbackFeeMicroCc = String(
        Math.round(Math.abs(fallbackFeeCc) * 1_000_000),
      );

      // Fee party short labels — transfer ke party ini (canquest-fee/validator)
      // disembunyikan dari history on-chain agar konsisten dengan filter DB
      // (CC_TRANSACTION_HISTORY_WHERE).
      const feeLabels = feePartyLabels();
      const isFeeParty = (party: string | null | undefined): boolean => {
        if (!party || feeLabels.length === 0) return false;
        const v = party.trim();
        if (!v) return false;
        return feeLabels.some(
          (label) => v === label || v.startsWith(`${label}::`),
        );
      };

      const transactions = result.transfers
        .filter((tx) => {
          // Buang transfer yang SEMUA sender/receiver-nya party fee/validator.
          const senders = tx.senders ?? [];
          const receivers = tx.receivers ?? [];
          const senderParties = senders.map((s) => s.partyId);
          const receiverParties = receivers.map((r) => r.partyId);
          const allParties = [...senderParties, ...receiverParties];
          if (allParties.length === 0) return true;
          return !allParties.every((p) => isFeeParty(p));
        })
        .map((tx) => {
          const sender = tx.senders?.[0];
          const receiver = tx.receivers?.[0];
          const counterparty =
            sender?.partyId === partyId
              ? receiver?.accountName
              : sender?.accountName;
          return {
            id: tx.eventId,
            event_id: tx.eventId,
            kind: tx.transferType ?? null,
            sender_address: sender?.partyId ?? null,
            receiver_address: receiver?.partyId ?? null,
            counterparty: counterparty ?? null,
            amount: String(tx.amount ?? 0),
            created_at: new Date(Number(tx.createdAt)).toISOString(),
            network_fee:
              tx.fee != null
                ? String(Math.round(Math.abs(tx.fee) * 1_000_000))
                : fallbackFeeMicroCc,
            contract_id: null,
            update_id: null,
            round: null,
            scan_url: this.modo.explorerUrl(tx.eventId),
          };
        });

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
        result.updateId ?? undefined,
      );
    } catch (err) {
      this.logger.warn(
        `markTransferInstructionSettled (legacy) failed: ${String(err)}`,
      );
    }
    // ── PENERIMA selalu dapat history TRANSFER_IN saat accept (Fix UX) ──
    // Sebelumnya: recordTransaction TRANSFER_IN hanya jalan kalau
    // settledOwnReward === 0. Tapi markTransferInstructionSettled match row
    // PENDING global (milik SENDER) → return >0 → blok di-skip → PENERIMA
    // tidak dapat history. Cegah double via unique constraint
    // @@unique([userId, ledgerTxId]), bukan via settledOwnReward.
    try {
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
        cantonUpdateId: result.updateId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `Recipient TRANSFER_IN on legacy accept failed (cid=${contractId.slice(0, 16)}…): ${String(err)}`,
      );
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
        result.updateId ?? undefined,
      );
    } catch (err) {
      this.logger.warn(
        `markTransferInstructionSettled (legacy reject) failed: ${String(err)}`,
      );
    }
    // ── PENERIMA selalu dapat history OFFER_REJECTED saat reject (Fix UX) ──
    // Lihat catatan di acceptOfferInbox: markTransferInstructionSettled match
    // row PENDING global (milik SENDER) → return >0 → blok lama di-skip →
    // PENERIMA tidak dapat history reject. Cegah double via unique constraint.
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: 0,
        type: 'OFFER_REJECTED',
        description:
          `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
          (amountCc > 0 ? ` (${amountCc} CC)` : ''),
        ledgerTxId: result.updateId ?? contractId,
        cantonUpdateId: result.updateId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `Recipient OFFER_REJECTED on legacy reject failed (cid=${contractId.slice(0, 16)}…): ${String(err)}`,
      );
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
  // CC LOCK — Spec CC Lock CanQuest (CC stays owned by user's party; returned at expiry)
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
    // ledgerTxId = Canton update_id ("1220…") → handler ulang tidak akan mendobel-catat,
    // dan link explorer Modo langsung jalan. lockedAmuletCid tersimpan terpisah di
    // ccLocks (dipakai saat unlock), tidak perlu duplikat di kolom cantonUpdateId.
    if (result.updateId || result.lockedAmuletCid) {
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc,
          type: 'CC_LOCK',
          description: 'CC Locked',
          referenceId: lockRow?.id,
          // ledgerTxId + cantonUpdateId = Canton update_id supaya link explorer jalan.
          // Fallback ke lockedAmuletCid (contract_id) bila updateId tidak ter-parse —
          // link akan di-resolve lazy via Modo /v1/contracts/{id}.
          ledgerTxId: result.updateId ?? result.lockedAmuletCid,
          cantonUpdateId: result.updateId ?? undefined,
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
    // ledgerTxId + cantonUpdateId = Canton update_id ASLI dari exercise (link Modo benar).
    // Relasi ke lock asli disimpan di referenceId (lock.id); lockedAmuletCid asli tetap
    // di ccLocks. Bila updateId tidak ter-parse, ledgerTxId null → link explorer
    // disembunyikan (bukan marker palsu).
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: Number(lock.amountCc),
        type: 'CC_UNLOCK',
        description: 'CC Unlocked',
        referenceId: lock.id,
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
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

  // ═══════════════════════════════════════════════════════════════════════
  // SWAP — Cantex DEX integration (CC ↔ semua token Cantex)
  // Custodial Wintip-style: token non-CC di off-chain CantexTokenBalance.
  // ═══════════════════════════════════════════════════════════════════════

  /** GET /party/swap/status — apakah fitur swap aktif (CANTEX_ENABLED). */
  @Get('swap/status')
  @SkipThrottle()
  async swapStatus() {
    const enabled = isCantexEnabled();
    return {
      enabled,
      phase: 'quote', // 'quote' (Phase 1) | 'execution' (Phase 2)
      executionReady: false,
      message: enabled
        ? 'Swap quote live. Execution coming soon.'
        : 'Swap not enabled.',
    };
  }

  /**
   * GET /party/swap/balances — saldo user untuk SEMUA token swap-able.
   * Dipakai frontend untuk tombol percent (25/50/75/MAX) di setiap token,
   * bukan cuma CC. CC saldo dari CcBalance (on-chain mirror); token non-CC
   * di-merge: on-chain holdings (sumber kebenaran) + DB custody (off-chain).
   *
   * FIX-1b: saldo non-CC sekarang PURE on-chain (sumber kebenaran).
   * Sebelumnya: merge max(DB, on-chain) — DB off-chain (CantexTokenBalance)
   * tetap tampil walau bukan token asli (drift dari swap fallback). User minta
   * hapus off-chain: pakai on-chain saja. DB CantexTokenBalance tetap dipakai
   * untuk swap accounting internal, tapi TIDAK ditampilkan ke UI.
   */
  @Get('swap/balances')
  @SkipThrottle()
  async swapBalances(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) {
      throw new ForbiddenException('User not found.');
    }
    // CC saldo (micro → decimal) — dari DB (CcBalance = on-chain mirror, reliable).
    const ccBal = await this.prisma.ccBalance.findUnique({
      where: { userId: user.id },
      select: { balanceMicroCc: true },
    });
    const ccAmount = ccBal ? Number(ccBal.balanceMicroCc) / 1_000_000 : 0;

    // Non-CC token saldo: PURE on-chain (sumber kebenaran).
    // DB off-chain (CantexTokenBalance) TIDAK dipakai untuk display.
    const tokens: Record<string, string> = {};

    if (user.cantonPartyId && !user.cantonPartyId.startsWith('canquest:')) {
      try {
        // Ambil daftar token yang dikenal dari Cantex pools.
        const instruments = await this.cantex.getAllSwapInstruments();
        // Query on-chain holdings untuk setiap token non-CC (parallel).
        const onChainResults = await Promise.all(
          instruments
            .filter((inst) => inst.id.toLowerCase() !== 'amulet')
            .map(async (inst) => {
              const key = `${inst.id}::${inst.admin}`;
              try {
                const holdings = await this.ledger.queryTokenHoldings(
                  user.cantonPartyId!,
                  inst.id,
                  inst.admin,
                );
                const sum = holdings.reduce(
                  (acc, h) => acc + Number(h.amount || 0),
                  0,
                );
                this.logger.debug(
                  `swapBalances on-chain: ${inst.id} → ${holdings.length} holdings, sum=${sum}`,
                );
                return { key, onChainAmount: sum };
              } catch (err) {
                this.logger.warn(
                  `queryTokenHoldings failed for ${inst.id}: ${String(err)}`,
                );
                return { key, onChainAmount: 0 };
              }
            }),
        );
        for (const { key, onChainAmount } of onChainResults) {
          // Pure on-chain: tampilkan apa adanya (0 kalau tidak pegang).
          tokens[key] = onChainAmount.toFixed(10);
        }
      } catch (err) {
        this.logger.warn(
          `swapBalances on-chain query failed: ${String(err)}`,
        );
      }
    }

    return {
      cc: ccAmount,
      tokens,
    };
  }

  /**
   * GET /party/swap/prices — harga USD semua token dari Cantex DEX
   * (rate token→USDCx, USDCx = $1 anchor). Cache 30s di CantexClient.
   * Dipakai frontend untuk total balance USD + per-token fiat value.
   */
  @Get('swap/prices')
  @SkipThrottle()
  async swapPrices() {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    try {
      const prices = await this.cantexPrices.getTokenPrices();
      return { prices, source: 'cantex_ws_live' };
    } catch (err) {
      this.logger.error(
        `swap/prices failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not fetch token prices. Try again later.',
      );
    }
  }

  /**
   * GET /party/swap/pools — daftar SEMUA token yang bisa di-swap (termasuk
   * Amulet/CC). User bisa pilih token mana pun di slot atas ATAU bawah.
   * Live dari Cantex DEX (read-only, no risk).
   */
  @Get('swap/pools')
  @SkipThrottle()
  async swapPools(@Req() req: AuthedReq) {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    // Wallet gate — swap butuh wallet (CC ada di party user).
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new ForbiddenException(
        'You need a Canton wallet to use swap. Create yours first.',
      );
    }
    try {
      const instruments = await this.cantex.getAllSwapInstruments();
      // Tandai mana yang CC/Amulet (untuk logo + label FE).
      const ccId = (
        process.env.CANTEX_CC_INSTRUMENT_ID ?? 'Amulet'
      ).toLowerCase();
      return {
        tokens: instruments.map((t) => ({
          instrumentId: t.id,
          instrumentAdmin: t.admin,
          isCC: t.id.toLowerCase() === ccId,
        })),
      };
    } catch (err) {
      this.logger.error(
        `swap/pools failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not reach Cantex DEX. Try again later.',
      );
    }
  }

  /**
   * POST /party/swap/quote — live swap quote (preview sebelum konfirmasi).
   * Tampilkan: output estimate, price impact, fees.
   * Live dari Cantex DEX (read-only, no risk).
   */
  @Post('swap/quote')
  @SkipThrottle()
  async swapQuote(@Req() req: AuthedReq, @Body() body: SwapQuoteDto) {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    // Validasi: sell != buy (tidak bisa swap token ke dirinya sendiri).
    if (
      body.sellInstrumentId === body.buyInstrumentId &&
      body.sellInstrumentAdmin === body.buyInstrumentAdmin
    ) {
      throw new BadRequestException(
        'Cannot swap a token to itself. Select different tokens.',
      );
    }
    try {
      const quote = await this.cantex.getQuote({
        sellAmount: String(body.amount),
        sellInstrumentId: body.sellInstrumentId,
        sellInstrumentAdmin: body.sellInstrumentAdmin,
        buyInstrumentId: body.buyInstrumentId,
        buyInstrumentAdmin: body.buyInstrumentAdmin,
      });
      return {
        sellAmount: quote.sellAmount.toString(),
        sellInstrument: quote.sellInstrument,
        buyInstrument: quote.buyInstrument,
        // Estimasi output (yang dibeli user).
        outputAmount: quote.returned.amount.toString(),
        outputInstrument: quote.returned.instrument,
        // Fee + price impact. Tiap fee pakai instrument aslinya dari Cantex.
        fees: {
          feePercentage: quote.fees.feePercentage.toString(),
          adminFee: quote.fees.amountAdmin.toString(),
          liquidityFee: quote.fees.amountLiquidity.toString(),
          networkFee: quote.fees.networkFee.amount.toString(),
          feeInstrument: quote.fees.instrument,
          networkFeeInstrument: quote.fees.networkFee.instrument,
          platformFee: String(
            Number(this.config.get<string>('SWAP_PLATFORM_FEE_CC') ?? '0'),
          ),
        },
        prices: {
          slippage: quote.prices.slippage.toString(),
          tradePrice: quote.prices.trade.toString(),
          tradePriceNoFees: quote.prices.tradeNoFees.toString(),
          poolPriceBefore: quote.prices.poolBefore.toString(),
          poolPriceAfter: quote.prices.poolAfter.toString(),
        },
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
      };
    } catch (err) {
      if (err instanceof CantexError) {
        this.logger.warn(`swap/quote Cantex error: ${err.message}`);
        throw new BadRequestException(`Could not get quote: ${err.message}`);
      }
      this.logger.error(
        `swap/quote failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException(
        'Could not reach Cantex DEX. Try again later.',
      );
    }
  }

  /**
   * POST /party/swap — execute swap CC ↔ token (live, custodial Wintip-style).
   * SwapService handles the full flow: CC transfer + Cantex swap + WS confirm +
   * off-chain balance update + platform fee.
   */
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  @Post('swap')
  async swap(@Req() req: AuthedReq, @Body() body: SwapDto) {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new ForbiddenException(
        'You need a Canton wallet to use swap. Create yours first.',
      );
    }
    const result = await this.swapService.executeSwap(req.user.userId, {
      sellInstrumentId: body.sellInstrumentId,
      sellInstrumentAdmin: body.sellInstrumentAdmin,
      buyInstrumentId: body.buyInstrumentId,
      buyInstrumentAdmin: body.buyInstrumentAdmin,
      amount: body.amount,
      walletPassword: body.walletPassword,
      sellIsCC: body.sellIsCC,
      clientNonce: body.clientNonce,
      maxNetworkFee: body.maxNetworkFee,
    });
    if (!result.success) {
      throw new BadRequestException(
        result.message ?? 'Swap failed. Please try again.',
      );
    }
    return {
      success: true,
      direction: result.direction,
      outputAmount: result.outputAmount,
      swapId: result.swapId,
    };
  }

  /**
   * GET /party/swap/account-status — cek apakah Cantex trading account sudah
   * provisioned (pool trading account + intent account). Dipakai untuk
   * debugging/provisioning check.
   */
  @Get('swap/account-status')
  @SkipThrottle()
  async swapAccountStatus() {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    try {
      const admin = await this.cantex.getAccountAdmin();
      return {
        address: admin.address,
        hasIntentAccount: admin.hasIntentAccount,
        hasTradingAccount: admin.hasTradingAccount,
        intentAccountContractId: admin.intentAccountContractId,
        tradingAccountContractId: admin.tradingAccountContractId,
        ready: admin.hasIntentAccount && admin.hasTradingAccount,
      };
    } catch (err) {
      this.logger.error(
        `swap/account-status failed: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Could not check Cantex account status.',
      );
    }
  }

  /**
   * POST /party/swap/provision — create Cantex pool trading account (one-off).
   * Dipanggil sekali untuk provisioning. Idempotent: kalau sudah ada, return OK.
   */
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('swap/provision')
  async swapProvision() {
    if (!isCantexEnabled()) {
      throw new ServiceUnavailableException('Swap is not enabled.');
    }
    try {
      const admin = await this.cantex.getAccountAdmin();
      if (admin.hasTradingAccount) {
        return {
          success: true,
          message: 'Trading account already exists.',
          tradingAccountContractId: admin.tradingAccountContractId,
        };
      }
      // Create pool trading account.
      await this.cantex.createTradingAccount();
      // Verify.
      const after = await this.cantex.getAccountAdmin();
      return {
        success: after.hasTradingAccount,
        message: after.hasTradingAccount
          ? 'Trading account created successfully.'
          : 'Provisioning submitted but not confirmed yet. Try again in 30s.',
        tradingAccountContractId: after.tradingAccountContractId,
      };
    } catch (err) {
      this.logger.error(
        `swap/provision failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new BadRequestException(
        `Provisioning failed: ${(err as Error).message}`,
      );
    }
  }
}
