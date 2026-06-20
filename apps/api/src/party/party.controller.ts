import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { WalletInviteCodeService } from './wallet-invite-code.service';
import { AllocateWalletDto } from './dto/allocate-wallet.dto';
import { CantonPartyBindingDto } from './dto/canton-party-binding.dto';
import { SetUsernameDto } from './dto/set-username.dto';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyController {
  private readonly logger = new Logger(PartyController.name);

  /** Cooldown toggle preapproval: 1× per 7 hari (tiap re-enable burn ~1.5 CC). */
  private static readonly PREAPPROVAL_TOGGLE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  /** Lempar 400 jika masih dalam cooldown 7 hari sejak toggle terakhir. */
  private assertPreapprovalToggleCooldown(toggledAt: Date | null | undefined): void {
    if (!toggledAt) return;
    const elapsed = Date.now() - new Date(toggledAt).getTime();
    const remaining = PartyController.PREAPPROVAL_TOGGLE_COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
      const nextAt = new Date(Date.now() + remaining).toISOString();
      throw new BadRequestException(
        `Pengaturan preapproval dibatasi 1× per 7 hari untuk mencegah biaya berulang. ` +
        `Coba lagi dalam ~${days} hari (setelah ${nextAt}).`,
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
    private readonly prisma: PrismaService,
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
      'Wallet was created on the wrong Canton participant (suffix after :: does not match your TestNet validator). ' +
        'Both SSH tunnels must target the same validator stack on 162.250.190.204: ' +
        '7575 → participant container, 8080 → nginx (wallet.localhost). ' +
        'Do not use DevNet (162.250.191.46). Re-run tunnel-testnet.ps1 with correct Docker IPs, then create a new wallet.',
    );
  }

  @Get('wallet-access')
  @SkipThrottle()
  async walletAccessStatus(@Req() req: AuthedReq) {
    const hasRedeemedInvite = await this.walletInvites.userHasRedeemedInvite(req.user.userId);
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
      await this.walletInvites.assertCanCreateWallet(req.user.userId, inviteCode);
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
        await this.walletInvites.redeemAfterWalletCreated(req.user.userId, inviteCode);
        await this.walletInvites.recordAllocation({
          userId: req.user.userId,
          username,
          partyId: cantonPartyId,
        });
      }

      void this.featuredActivity
        .recordActivity('wallet_created', cantonPartyId, `Wallet created for @${username}`)
        .catch(() => { /* non-critical */ });

      // TransferPreapproval (dipertahankan dari flow lama)
      let preapprovalActive = false;
      const existingPreapproval = await this.splice.hasTransferPreapproval(cantonPartyId);
      if (existingPreapproval) {
        preapprovalActive = true;
      } else {
        preapprovalActive = (await this.splice.createTransferPreapproval(username)).ok;
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
            this.logger.warn(`PartyRegistration ledger record failed: ${String(err)}`);
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
        await this.walletInvites.releaseReservation(req.user.userId, inviteCode);
      }
      throw err;
    }
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('ensure-preapproval')
  async ensurePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) {
      throw new BadRequestException('Create your wallet first from the Wallet page.');
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
      throw new BadRequestException('Could not resolve Splice wallet username for this party.');
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
        throw new BadRequestException(onboard.detail ?? 'Wallet not registered in Splice.');
      }
      walletUsername = onboard.username ?? preferredUsername;
    }

    const existing = await this.splice.hasTransferPreapproval(user.cantonPartyId);
    if (existing) {
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
      .recordActivity('wallet_created', user.cantonPartyId, `Preapproval enabled for @${user.username}`)
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
        message: 'No wallet found. Create your wallet first from the Wallet page.',
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
  async allocateCantonParty(@Req() req: AuthedReq, @Body() body: AllocateWalletDto) {
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
      await this.walletInvites.assertCanCreateWallet(req.user.userId, inviteCode);
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
        const storedPartyId = normalizeCantonPartyId(splicePartyId) ?? splicePartyId;
        if (needsInviteFlow) {
          await this.walletInvites.redeemAfterWalletCreated(user.id, inviteCode);
          await this.walletInvites.recordAllocation({
            userId: user.id,
            username,
            partyId: storedPartyId,
          });
        }
        const preapprovalActive = (await this.splice.createTransferPreapproval(username)).ok;
        return {
          cantonPartyId: storedPartyId,
          isPlaceholder: false,
          spliceOnboarded: true,
          preapproval: { active: preapprovalActive },
          message: preapprovalActive
            ? 'Wallet created — Party ID registered. Direct CC transfers enabled (CIP-56 compliant).'
            : 'Wallet created — Party ID allocated and registered in Splice validator.',
        };
      }

      const cantonPartyId = await this.ledger.allocateParty(username);
      this.assertPartyOnValidatorParticipant(cantonPartyId);
      await this.users.setPartyId(req.user.userId, cantonPartyId, user.username ?? undefined);
      const storedPartyId = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId;
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
        message: 'Party ID allocated on Canton participant. Set CANTON_VALIDATOR_URL for full Splice registration.',
      };
    } catch (err) {
      if (needsInviteFlow) {
        await this.walletInvites.releaseReservation(req.user.userId, inviteCode);
      }
      throw err;
    }
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('canton-binding')
  async bindCantonParty(@Req() req: AuthedReq, @Body() body: CantonPartyBindingDto) {
    const cantonPartyId = body.cantonPartyId.trim();
    this.assertPartyOnValidatorParticipant(cantonPartyId);
    await this.users.setPartyId(req.user.userId, cantonPartyId);
    return {
      cantonPartyId,
      isPlaceholder: false,
      message: 'Canton Party ID saved manually. No ledger validation was performed.',
    };
  }

  @SkipThrottle()
  @Get('balance')
  async getBalance(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username) {
      return { balance: null, message: 'No wallet found. Create your wallet first.' };
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

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('claim-reward')
  async claimReward(
    @Req() req: AuthedReq,
    @Body() body: { amount: number; description?: string },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }

    // Hybrid: try CIP-0056 first, fallback to Splice TransferOffer
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';

    let accepted = false;
    let ledgerTxId: string | null = null;

    // Try CIP-0056
    const cip56Result = await this.ledger.executeTransferFactoryTransfer({
      senderPartyId: validatorPartyId,
      receiverPartyId: user.cantonPartyId,
      amountCc: body.amount,
      description: body.description ?? 'CanQuest reward',
    });

    if (cip56Result.ok) {
      accepted = cip56Result.transferKind === 'direct';
      ledgerTxId = cip56Result.updateId ?? cip56Result.transferInstructionCid ?? null;
      if (!accepted && cip56Result.transferInstructionCid) {
        const acceptResult = await this.ledger.acceptTransferInstruction(
          cip56Result.transferInstructionCid,
          user.cantonPartyId,
        );
        accepted = acceptResult.ok;
      }
    }

    // Fallback to Splice TransferOffer if CIP-0056 failed
    if (!cip56Result.ok) {
      this.logger.log(`claimReward fallback to Splice TransferOffer: ${cip56Result.error?.slice(0, 80) ?? 'unknown'}`);
      const offerContractId = await this.splice.createTransferOffer(
        user.cantonPartyId,
        body.amount,
        body.description ?? 'CanQuest reward',
      );
      if (!offerContractId) {
        throw new BadRequestException('Failed to create transfer. Both CIP-0056 and Splice fallback failed.');
      }
      accepted = await this.splice.acceptOfferViaWallet(offerContractId, user.username);
      ledgerTxId = offerContractId;
    }

    if (accepted && ledgerTxId) {
      const row = await this.users.recordTransaction({
        userId: user.id,
        amountCc: body.amount,
        type: 'TRANSFER_IN',
        description: body.description ?? 'CanQuest reward',
        counterparty: 'Validator (reward)',
        ledgerTxId,
      });
      if (user.cantonPartyId) {
        void this.txDetail.backfillUpdateId(row.id, ledgerTxId, user.cantonPartyId);
      }
    }

    if (!accepted) {
      throw new BadRequestException(
        'Reward transfer failed — offer was not accepted. No transaction was recorded.',
      );
    }

    return {
      ledgerTxId,
      accepted: true,
      amount: body.amount,
      message: `${body.amount} CC sent to ${user.username}. It should appear in your wallet shortly.`,
    };
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
  async sendCc(
    @Req() req: AuthedReq,
    @Body() body: { recipientUsername: string; amount: number; memo?: string },
  ) {
    const sender = await this.users.findById(req.user.userId);
    if (!sender?.username || !sender.cantonPartyId) {
      throw new BadRequestException('You need a wallet to send CC. Create yours first.');
    }

    const amount = Number(body.amount);
    if (!amount || amount <= 0) throw new BadRequestException('Amount must be greater than 0.');

    const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5');
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';

    const recipientInput = body.recipientUsername?.trim();
    if (!recipientInput) throw new BadRequestException('Recipient is required.');

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
      recipientPartyId = normalizedRecipient;
      recipientLabel = normalizedRecipient.split('::')[0] ?? normalizedRecipient;
      const found = await this.users.findByPartyId(normalizedRecipient);
      recipientUsername =
        found?.username?.toLowerCase() ?? (recipientLabel || null);
    } else {
      const username = recipientInput.replace(/^@/, '').toLowerCase();
      if (username === sender.username?.toLowerCase()) {
        throw new BadRequestException('You cannot send CC to yourself.');
      }
      const dbUser = await this.users.findByUsernameInsensitive(username);
      const resolved = dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
      if (!resolved) {
        throw new BadRequestException(`User "@${username}" not found or has no wallet.`);
      }
      recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
      recipientLabel = `@${username}`;
      recipientUsername = dbUser?.username?.toLowerCase() ?? username;
    }

    const description = body.memo?.trim() || `Sent to ${recipientLabel}`;
    const recipientDbUser = recipientUsername
      ? await this.users.findByUsernameInsensitive(recipientUsername) : null;
    const isInternalUser = recipientDbUser !== null;
    const effectiveFeeCc = feeCc;

    // ── Balance check (DB cache only — tidak blokir dengan HS256) ─────
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
    let transferMethod: 'direct' | 'offer_accept' | 'offer_only' = 'offer_accept';

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
        this.logger.log(`CC transfer direct: ${sender.username} → ${recipientLabel} ${amount} CC`);
      } else if (cip56Result.transferKind === 'offer') {
        ledgerTxId = cip56Result.transferInstructionCid ?? cip56Result.updateId ?? undefined;
        if (isInternalUser && recipientUsername && cip56Result.transferInstructionCid) {
          const acceptResult = await this.ledger.acceptTransferInstruction(
            cip56Result.transferInstructionCid, recipientPartyId);
          accepted = acceptResult.ok;
          transferMethod = accepted ? 'offer_accept' : 'offer_only';
        } else {
          transferMethod = 'offer_only';
        }
      }
    }

    if (!cip56Result.ok) {
      throw new BadRequestException(
        `Transfer gagal: ${cip56Result.error?.slice(0, 120) ?? 'unknown'}`);
    }

    // ── FEE COLLECT (HANYA jika transfer berhasil) ───────────────────
    let feeCollected = false;
    let feeLedgerTxId: string | undefined;
    let feeTreasuryPartyId: string | undefined;

    if (effectiveFeeCc > 0 && sender.cantonPartyId && accepted) {
      const feeParty = this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim()
        || validatorPartyId;
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
              counterparty: normalizeCantonPartyId(feeParty) ?? feeParty,
              ledgerTxId: feeLedgerTxId,
            });
            this.logger.log(
              `Fee collected: ${sender.username} → ${feeParty.split('::')[0]} ${effectiveFeeCc} CC (direct)`,
            );
          } else if (feeResult.ok && feeResult.transferKind === 'offer' && feeResult.transferInstructionCid) {
            const acceptR = await this.ledger.acceptTransferInstruction(
              feeResult.transferInstructionCid, feeParty);
            if (acceptR.ok) {
              feeCollected = true;
              feeLedgerTxId = acceptR.updateId ?? feeResult.updateId ?? undefined;
              feeTreasuryPartyId = feeParty;
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: effectiveFeeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (transfer to ${recipientLabel})`,
                counterparty: normalizeCantonPartyId(feeParty) ?? feeParty,
                ledgerTxId: feeLedgerTxId,
              });
              this.logger.log(
                `Fee collected: ${sender.username} → ${feeParty.split('::')[0]} ${effectiveFeeCc} CC (offer-accept)`);
            } else {
              this.logger.warn(`Fee offer accept failed: transfer proceeds without fee`);
            }
          } else {
            this.logger.warn(
              `Fee NOT collected (transferKind=${feeResult.transferKind}, ok=${feeResult.ok}). Transfer proceeds.`);
          }
        } catch (feeErr) {
          this.logger.warn(`Fee collect error (non-blocking): ${String(feeErr)}`);
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
        void this.txDetail.backfillUpdateId(outRow.id, ledgerTxId, sender.cantonPartyId);
      }

      if (sender.cantonPartyId) {
        void this.featuredActivity
          .recordActivity('cc_transfer', sender.cantonPartyId, `CC transfer ${amount} CC to ${recipientLabel}`)
          .catch(() => {});
      }

      if (isInternalUser && recipientDbUser) {
        await this.users.recordTransaction({
          userId: recipientDbUser.id,
          amountCc: amount,
          type: 'TRANSFER_IN',
          description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
          counterparty: normalizeCantonPartyId(sender.cantonPartyId) ?? sender.cantonPartyId,
          ledgerTxId: ledgerTxId,
        });
        if (recipientDbUser.username) {
          void this.inboundSync.alignBalanceFromChain(recipientDbUser.id, recipientDbUser.username);
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
          this.logger.warn(`CcTransferRecord ledger record failed: ${String(err)}`);
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
    @Body() body: { transferInstructionCid: string },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid) throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Accept: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.acceptTransferInstruction(cid, user.cantonPartyId);

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
    @Body() body: { transferInstructionCid: string },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid) throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Reject: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.rejectTransferInstruction(cid, user.cantonPartyId);

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to reject transfer instruction: ${result.error ?? 'unknown error'}`,
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
    @Body() body: { transferInstructionCid: string },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid) throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Withdraw: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    const result = await this.ledger.withdrawTransferInstruction(cid, user.cantonPartyId);

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to withdraw transfer instruction: ${result.error ?? 'unknown error'}`,
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
      throw new BadRequestException('No wallet found. Create your wallet first.');
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
        this.logger.log(`Fallback Splice: ${offers.length} offers for @${user.username}`);
      }
    }

    // Resolve sender labels from DB where possible
    const enriched = await Promise.all(
      offers.map(async (offer) => {
        let senderLabel = offer.sender.split('::')[0] ?? offer.sender;
        try {
          const senderUser = await this.users.findByPartyId(offer.sender);
          if (senderUser?.username) senderLabel = `@${senderUser.username}`;
        } catch { /* keep party hint */ }
        return { ...offer, senderLabel };
      }),
    );

    return {
      offers: enriched,
      total: enriched.length,
      legacyCount: enriched.filter((o) => o.type === 'transfer_offer').length,
      cip56Count: enriched.filter((o) => o.type === 'transfer_instruction').length,
    };
  }

  /**
   * Accept a pending transfer offer (auto-detects type: legacy or CIP-0056).
   */
  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('offers/accept')
  async acceptOfferInbox(
    @Req() req: AuthedReq,
    @Body() body: { contractId: string; type?: 'transfer_offer' | 'transfer_instruction' },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !user.username || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    const offerType = body.type ?? 'transfer_offer';
    this.logger.log(`Accept offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`);

    let ok = false;
    let updateId: string | null = null;

    if (offerType === 'transfer_instruction') {
      // CIP-0056 TransferInstruction
      const result = await this.ledger.acceptTransferInstruction(cid, user.cantonPartyId);
      ok = result.ok;
      updateId = result.updateId;
      if (!ok) {
        throw new BadRequestException(`Failed to accept: ${result.error ?? 'unknown'}`);
      }
    } else {
      // Legacy Splice TransferOffer — try Ledger API first, then Splice Wallet API
      const result = await this.ledger.acceptTransferOffer(cid, user.cantonPartyId);
      ok = result.accepted;
      updateId = result.updateId;
      if (!ok) {
        // Fallback to Splice Wallet API
        ok = await this.splice.acceptOfferViaWallet(cid, user.username);
      }
      if (!ok) {
        throw new BadRequestException('Failed to accept transfer offer.');
      }
    }

    // Record incoming transaction
    await this.users.recordTransaction({
      userId: user.id,
      amountCc: 0, // akan di-sync dari chain
      type: 'TRANSFER_IN',
      description: `Accepted incoming ${offerType === 'transfer_instruction' ? 'CIP-0056' : 'legacy'} transfer`,
      counterparty: 'sender',
      ledgerTxId: updateId ?? cid,
    });

    // Reward yang tadinya PENDING (offer) kini diterima → tandai COMPLETED
    try {
      await this.users.markTransferInstructionSettled(cid, 'COMPLETED');
    } catch (err) {
      this.logger.warn(`markTransferInstructionSettled failed: ${String(err)}`);
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
    @Body() body: { contractId: string; type?: 'transfer_offer' | 'transfer_instruction' },
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    const offerType = body.type ?? 'transfer_offer';
    this.logger.log(`Reject offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`);

    if (offerType === 'transfer_instruction') {
      const result = await this.ledger.rejectTransferInstruction(cid, user.cantonPartyId);
      if (!result.ok) {
        throw new BadRequestException(`Failed to reject: ${result.error ?? 'unknown'}`);
      }
      // Reward PENDING yang ditolak → tandai REJECTED
      try {
        await this.users.markTransferInstructionSettled(cid, 'REJECTED');
      } catch (err) {
        this.logger.warn(`markTransferInstructionSettled REJECTED failed: ${String(err)}`);
      }
      return { ok: true, updateId: result.updateId, message: 'Transfer rejected. CC returned to sender.' };
    } else {
      const result = await this.ledger.rejectTransferOffer(cid, user.cantonPartyId);
      if (!result.rejected) {
        throw new BadRequestException('Failed to reject transfer offer.');
      }
      return { ok: true, updateId: result.updateId, message: 'Transfer offer rejected.' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Preapproval Toggle — enable/disable TransferPreapproval
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current preapproval status for the user's wallet.
   */
  @SkipThrottle()
  @Get('preapproval')
  async getPreapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }

    const preapproval = await this.splice.getTransferPreapproval(user.cantonPartyId);

    return {
      active: preapproval !== null,
      expiresAt: preapproval?.expiresAt ?? null,
      provider: preapproval?.provider ?? null,
      message: preapproval
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
    if (!user?.cantonPartyId || !user.username || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }

    // Already active? (Ledger ACS — no HS256)
    const existing = await this.ledger.getTransferPreapprovalViaLedger(user.cantonPartyId);
    if (existing) {
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
    const result = await this.ledger.createTransferPreapprovalViaLedger(user.cantonPartyId);
    if (!result.ok) {
      throw new BadRequestException(result.error ?? 'Failed to create preapproval.');
    }

    // Sukses & burn terjadi → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    return {
      ok: true,
      alreadyActive: false,
      transferPreapprovalCid: result.transferPreapprovalCid,
      amuletPaid: result.amuletPaid,
      message: 'Preapproval enabled — incoming CC transfers will now arrive directly.',
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
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }

    // Check if active (Ledger ACS — no HS256)
    const existing = await this.ledger.getTransferPreapprovalViaLedger(user.cantonPartyId);
    if (!existing) {
      return {
        ok: true,
        wasActive: false,
        message: 'Preapproval is already inactive.',
      };
    }

    // Cooldown 7 hari (gate state-change)
    this.assertPreapprovalToggleCooldown(user.preapprovalToggleAt);

    // Cancel via Ledger (primary, no HS256)
    const result = await this.ledger.cancelTransferPreapprovalViaLedger(user.cantonPartyId);
    if (!result.ok) {
      throw new BadRequestException(
        `Failed to disable preapproval: ${result.error ?? 'unknown'}`,
      );
    }

    // Sukses → set cooldown
    await this.users.markPreapprovalToggle(req.user.userId);

    return {
      ok: true,
      wasActive: true,
      message: 'Preapproval disabled — incoming CC transfers will now appear as offers.',
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
    const ps = Math.min(20, Math.max(1, parseInt(pageSize ?? '5', 10) || 5));
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

    const lighthouseUrl = (
      this.config.get<string>('LIGHTHOUSE_API_URL') ??
      'https://api-canton.interscan.pro/mainnet'
    ).replace(/\/$/, '');

    const url = new URL(
      `${lighthouseUrl}/api/parties/${encodeURIComponent(partyId)}/transfers`,
    );
    const n = Math.min(50, Math.max(1, parseInt(limit ?? '15', 10) || 15));
    url.searchParams.set('limit', String(n));
    if (cursor) url.searchParams.set('cursor', cursor);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Lighthouse onchain fetch HTTP ${res.status}`);
        return { transactions: [], pagination: null };
      }

      const data = (await res.json()) as Record<string, unknown>;

      // Network fee (CC) applied to every transfer — sourced from env so the
      // receipt shows a consistent fee even when Lighthouse omits it.
      const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '0.2');
      const networkFeeMicroCc = String(Math.round(Math.abs(feeCc) * 1_000_000));

      // Inject network_fee into every transfer-like array in the response.
      for (const key of ['transfers', 'transactions', 'items', 'data']) {
        const arr = data[key];
        if (Array.isArray(arr)) {
          data[key] = arr.map((item) =>
            item && typeof item === 'object'
              ? { ...(item as Record<string, unknown>), network_fee: networkFeeMicroCc }
              : item,
          );
        }
      }

      return data;
    } catch (err) {
      this.logger.warn(`Lighthouse onchain fetch error: ${String(err)}`);
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
  async acceptOffer(
    @Req() req: AuthedReq,
    @Body() body: { contractId: string },
  ) {
    const contractId = body.contractId?.trim();
    if (!contractId) {
      throw new BadRequestException('contractId is required.');
    }

    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }

    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException('Party ID is still a placeholder. Regenerate your wallet.');
    }

    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      user.username;

    this.logger.log(`Accept offer requested: user=@${walletUsername} contractId=${contractId.slice(0, 20)}…`);

    let accepted = false;
    let acceptMethod = '';

    if (this.splice.isConfigured) {
      accepted = await this.splice.acceptOfferViaWallet(contractId, walletUsername);
      if (accepted) {
        acceptMethod = 'splice_wallet_api';
        this.logger.log(`Offer accepted via Splice Wallet API: ${contractId.slice(0, 20)}…`);
      } else {
        this.logger.warn(`Splice Wallet API accept failed for ${contractId.slice(0, 20)}… — trying Canton Ledger API`);
      }
    }

    if (!accepted) {
      const result = await this.ledger.acceptTransferOffer(contractId, user.cantonPartyId);
      accepted = result.accepted;
      if (accepted) {
        acceptMethod = 'canton_ledger_api';
        this.logger.log(`Offer accepted via Canton Ledger API: ${contractId.slice(0, 20)}… updateId=${result.updateId?.slice(0, 16) ?? 'n/a'}`);
      } else {
        this.logger.warn(`Canton Ledger API accept also failed for ${contractId.slice(0, 20)}…`);
      }
    }

    if (!accepted) {
      throw new BadRequestException(
        'Could not accept the transfer offer. The offer may have expired or been processed already.',
      );
    }

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      accepted: true,
      contractId,
      method: acceptMethod,
      message: 'Transfer offer accepted. Funds should appear in your wallet shortly.',
    };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('reject-offer')
  async rejectOffer(
    @Req() req: AuthedReq,
    @Body() body: { contractId: string },
  ) {
    const contractId = body.contractId?.trim();
    if (!contractId) {
      throw new BadRequestException('contractId is required.');
    }

    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException('No wallet found. Create your wallet first.');
    }

    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException('Party ID is still a placeholder. Regenerate your wallet.');
    }

    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      user.username;

    this.logger.log(`Reject offer requested: user=@${walletUsername} contractId=${contractId.slice(0, 20)}…`);

    const result = await this.ledger.rejectTransferOffer(contractId, user.cantonPartyId);

    if (!result.rejected) {
      throw new BadRequestException(
        'Could not reject the transfer offer. The offer may have expired or been processed already.',
      );
    }

    this.logger.log(`Offer rejected: @${walletUsername} contractId=${contractId.slice(0, 20)}… updateId=${result.updateId?.slice(0, 16) ?? 'n/a'}`);

    return {
      rejected: true,
      contractId,
      updateId: result.updateId ?? null,
      message: 'Transfer offer rejected.',
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
      message: canton && splice
        ? 'Node connected.'
        : !canton
          ? 'Node connection issue'
          : 'Node connection issue',
    };
  }
}
