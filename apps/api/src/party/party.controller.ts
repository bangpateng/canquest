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

import { CantonLedgerService } from '../canton/canton-ledger.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
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

    let cantonPartyId: string;
    let isPlaceholder = false;
    let spliceOnboarded = false;
    const needsInviteFlow = !hasRealWallet(existing.cantonPartyId);
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
        cantonPartyId = splicePartyId;
        spliceOnboarded = true;
      } else {
        const ledgerReachable = await this.ledger.isReachable();
        if (ledgerReachable) {
          try {
            cantonPartyId = await this.ledger.allocateParty(username);
          } catch {
            cantonPartyId = `canquest:user:${username}:${req.user.userId.slice(0, 8)}`;
            isPlaceholder = true;
          }
        } else {
          cantonPartyId = `canquest:user:${username}:${req.user.userId.slice(0, 8)}`;
          isPlaceholder = true;
        }
      }

      const partyOwner = await this.users.findByPartyId(cantonPartyId);
      if (partyOwner && partyOwner.id !== req.user.userId) {
        throw new ConflictException('Party ID Already Taken');
      }

      if (!isPlaceholder) {
        this.assertPartyOnValidatorParticipant(cantonPartyId);
      }

      try {
        await this.users.setPartyId(req.user.userId, cantonPartyId, username);
        cantonPartyId = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId;
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
        if (!isPlaceholder) {
          await this.walletInvites.redeemAfterWalletCreated(req.user.userId, inviteCode);
          await this.walletInvites.recordAllocation({
            userId: req.user.userId,
            username,
            partyId: cantonPartyId,
          });
        } else {
          await this.walletInvites.releaseReservation(req.user.userId, inviteCode);
        }
      }

      void this.featuredActivity
        .recordActivity('wallet_created', cantonPartyId, `Wallet created for @${username}`)
        .catch(() => { /* non-critical */ });

      let preapprovalActive = false;
      if (spliceOnboarded) {
        const existingPreapproval = await this.splice.hasTransferPreapproval(cantonPartyId);
        if (existingPreapproval) {
          preapprovalActive = true;
        } else {
          preapprovalActive = (await this.splice.createTransferPreapproval(username)).ok;
        }
      }

      if (!isPlaceholder && needsInviteFlow) {
        void this.questLedger
          .recordPartyRegistration({
            userPartyId: cantonPartyId,
            username,
            inviteCode: inviteCode ?? '',
            spliceOnboarded,
            preapprovalActive,
          })
          .catch((err: unknown) => {
            this.logger.warn(`PartyRegistration ledger record failed: ${String(err)}`);
          });
      }

      let message: string;
      if (spliceOnboarded) {
        message = preapprovalActive
          ? 'Wallet created — Party ID registered. Direct CC transfers enabled (CIP-56 compliant).'
          : 'Wallet created — Party ID registered. CC transfers work via offer/accept flow.';
      } else if (!isPlaceholder) {
        message =
          'Party ID allocated on Canton participant. Splice validator not reachable (set CANTON_VALIDATOR_URL) — wallet not yet visible in explorer.';
      } else {
        message =
          'Saved with placeholder — both Canton JSON API and Splice validator unreachable. Start your SSH tunnels (7575 + 8080) and re-generate from the Wallet page.';
      }

      return {
        username,
        cantonPartyId,
        isPlaceholder,
        spliceOnboarded,
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

    // CIP-0056: Use Token Standard transfer instead of deprecated TransferOffer
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
    const cip56Result = await this.ledger.executeTransferFactoryTransfer({
      senderPartyId: validatorPartyId,
      receiverPartyId: user.cantonPartyId,
      amountCc: body.amount,
      description: body.description ?? 'CanQuest reward',
    });

    if (!cip56Result.ok) {
      throw new BadRequestException(
        `Failed to create CIP-0056 transfer: ${cip56Result.error ?? 'unknown'}. Check CANTON_SCAN_URL and CANTON_DSO_PARTY_ID.`,
      );
    }

    // If transferKind = "direct" → CC already landed (receiver has preapproval)
    // If transferKind = "offer"  → TransferInstruction created, auto-accept for internal user
    let accepted = cip56Result.transferKind === 'direct';
    if (!accepted && cip56Result.transferInstructionCid) {
      const acceptResult = await this.ledger.acceptTransferInstruction(
        cip56Result.transferInstructionCid,
        user.cantonPartyId,
      );
      accepted = acceptResult.ok;
    }

    const ledgerTxId = cip56Result.updateId ?? cip56Result.transferInstructionCid ?? null;

    if (accepted) {
      const row = await this.users.recordTransaction({
        userId: user.id,
        amountCc: body.amount,
        type: 'TRANSFER_IN',
        description: body.description ?? 'CanQuest reward',
        counterparty: 'Validator (reward)',
        ledgerTxId: ledgerTxId ?? undefined,
      });
      if (user.cantonPartyId && ledgerTxId) {
        void this.txDetail.backfillUpdateId(row.id, ledgerTxId, user.cantonPartyId);
      }
    }

    if (!accepted) {
      throw new BadRequestException(
        'Reward transfer failed — TransferInstruction was not accepted. No transaction was recorded.',
      );
    }

    return {
      ledgerTxId,
      transferKind: cip56Result.transferKind,
      accepted: true,
      amount: body.amount,
      message: `${body.amount} CC sent to ${user.username} via CIP-0056. It should appear in your wallet shortly.`,
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

    // Resolve recipient DB user first (needed for fee policy)
    const recipientDbUser = recipientUsername
      ? await this.users.findByUsernameInsensitive(recipientUsername)
      : null;
    const isInternalUser = recipientDbUser !== null;

    // ── Fee Policy ────────────────────────────────────────────────────────
    // Fee applies to ALL transfers (internal AND external/CEX).
    // Fee is sent to CANTON_FEE_RECIPIENT_PARTY_ID (canquest-fee wallet).
    // This is a separate transaction: fee first, then main transfer.
    const effectiveFeeCc = feeCc; // Always apply fee regardless of recipient type

    // Balance check: sender needs amount + fee
    const senderBalance = await this.splice.getUserBalance(sender.username);
    if (senderBalance !== null && senderBalance < amount + effectiveFeeCc) {
      throw new BadRequestException(
        effectiveFeeCc > 0
          ? `Insufficient balance. Need ${amount + effectiveFeeCc} CC (${amount} transfer + ${effectiveFeeCc} platform fee).`
          : `Insufficient balance. Need ${amount} CC.`,
      );
    }

    // ── Step 1: COLLECT FEE FIRST (all transfers) ─────────────────────────
    // Fee is sent to canquest-fee wallet (CANTON_FEE_RECIPIENT_PARTY_ID).
    // This is transaction #1. Main transfer is transaction #2.
    let feeCollected = false;
    let feeLedgerTxId: string | undefined;
    let feeTreasuryPartyId: string | undefined;

    if (effectiveFeeCc > 0 && sender.username) {
      const feeResult = await this.splice.collectPlatformFee({
        senderUsername: sender.username,
        feeCc: effectiveFeeCc,
        description: `Platform fee for transfer to ${recipientLabel}`,
      });
      feeCollected = feeResult.collected;
      feeLedgerTxId = feeResult.ledgerTxId;
      feeTreasuryPartyId = feeResult.treasuryPartyId ?? validatorPartyId;

      if (feeCollected) {
        await this.users.recordTransaction({
          userId: sender.id,
          amountCc: effectiveFeeCc,
          type: 'TRANSFER_OUT',
          description: `Platform fee (transfer to ${recipientLabel})`,
          counterparty: normalizeCantonPartyId(feeTreasuryPartyId) ?? feeTreasuryPartyId,
          ledgerTxId: feeLedgerTxId,
        });
        this.logger.log(
          `Fee collected: ${sender.username} → ${(feeTreasuryPartyId ?? '').split('::')[0]} ${effectiveFeeCc} CC (${feeResult.method ?? 'unknown'})`,
        );
      } else {
        throw new BadRequestException(
          `Platform fee (${effectiveFeeCc} CC) could not be collected. Transfer aborted. ` +
            (feeResult.error ?? 'Check your CC balance.'),
        );
      }
    }

    // ── Step 2: EXECUTE MAIN TRANSFER ────────────────────────────────────
    let accepted = false;
    let ledgerTxId: string | undefined;
    let transferTransactionId: string | undefined;
    let transferMethod: 'preapproval_send' | 'offer_accept' | 'offer_only' = 'offer_accept';

    try {
      // Path A: Try sendViaTransferPreapproval first (1-step).
      // The Splice validator itself decides if receiver has an active preapproval.
      // This works even if our local hasTransferPreapproval check fails (e.g. short party ID,
      // different participant, admin API 404). If receiver has no preapproval, Splice returns
      // an error and we fall through to Path B automatically.
      if (this.splice.isConfigured && sender.username) {
        this.logger.log(
          `Trying Path A (preapproval send): ${sender.username} → ${recipientLabel} ${amount} CC`,
        );
        const result = await this.splice.sendViaTransferPreapproval(
          sender.username, recipientPartyId, amount, description,
        );
        if (result.ok) {
          accepted = true;
          ledgerTxId = result.referenceId;
          transferMethod = 'preapproval_send';
          this.logger.log(`CC transfer (1-step preapproval OK): ${sender.username} → ${recipientLabel} ${amount} CC`);
        } else {
          // Receiver has no preapproval — fall through to Path B
          this.logger.log(
            `Path A failed (receiver has no preapproval): ${result.error?.slice(0, 100) ?? 'unknown'} — trying Path B (offer/accept)`,
          );
        }
      }

      // Path B: CIP-0056 Token Standard TransferFactory_Transfer
      // Creates AmuletTransferInstruction (recognized by ALL Canton wallets)
      // Replaces deprecated Splice REST createTransferOffer
      if (!accepted) {
        this.logger.log(
          `Path B (CIP-0056 TransferFactory): ${sender.username} → ${recipientLabel} ${amount} CC`,
        );

        const cip56Result = await this.ledger.executeTransferFactoryTransfer({
          senderPartyId: sender.cantonPartyId,
          receiverPartyId: recipientPartyId,
          amountCc: amount,
          description,
        });

        if (!cip56Result.ok) {
          throw new Error(
            `CIP-0056 transfer failed: ${cip56Result.error ?? 'unknown'}`,
          );
        }

        ledgerTxId = cip56Result.updateId ?? undefined;

        if (cip56Result.transferKind === 'direct') {
          // Receiver had preapproval on-chain — CC already transferred
          accepted = true;
          transferMethod = 'preapproval_send';
          this.logger.log(
            `CC transfer (CIP-0056 direct — preapproval on-chain): ${sender.username} → ${recipientLabel} ${amount} CC`,
          );
        } else if (cip56Result.transferKind === 'offer') {
          // AmuletTransferInstruction created — receiver must accept
          if (isInternalUser && recipientUsername && cip56Result.transferInstructionCid) {
            // Internal user: auto-accept TransferInstruction on their behalf
            const acceptResult = await this.ledger.acceptTransferInstruction(
              cip56Result.transferInstructionCid,
              recipientPartyId,
            );
            accepted = acceptResult.ok;
            transferMethod = accepted ? 'offer_accept' : 'offer_only';
            if (accepted) {
              this.logger.log(
                `CC transfer (CIP-0056 instruction auto-accepted): ${recipientLabel}`,
              );
            } else {
              this.logger.warn(
                `CIP-0056 instruction auto-accept failed: ${acceptResult.error ?? 'unknown'}`,
              );
            }
          } else {
            // External party: TransferInstruction created, receiver accepts in their wallet
            transferMethod = 'offer_only';
            ledgerTxId = cip56Result.transferInstructionCid ?? cip56Result.updateId ?? undefined;
            this.logger.log(
              `CC transfer (CIP-0056 instruction pending): ${cip56Result.transferInstructionCid?.slice(0, 20) ?? '?'}… — ` +
              `receiver accepts in Canton Loop / Supanova / etc`,
            );
          }
        }
      }
    } catch (mainTransferErr) {
      const errMsg = mainTransferErr instanceof Error ? mainTransferErr.message : String(mainTransferErr);
      this.logger.error(`Main transfer failed: ${errMsg} — refunding fee`);
      if (feeCollected && feeTreasuryPartyId && sender.username) {
        try {
          const r = await this.splice.collectPlatformFee({
            senderUsername: this.config.get<string>('CANTON_FEE_ACCEPT_USERNAME')?.trim() ||
              this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() || 'administrator',
            feeCc,
            description: `REFUND: Platform fee for transfer to ${recipientLabel}`,
          });
          if (r.collected) this.logger.log(`Fee refunded: ${feeCc} CC → @${sender.username}`);
          else this.logger.error(`Fee refund FAILED: ${r.error ?? 'unknown'}`);
        } catch (refundErr) {
          this.logger.error(`Fee refund exception: ${String(refundErr)}`);
        }
      }
      throw new BadRequestException(
        `Transfer failed: ${errMsg}. ${feeCollected ? `Fee (${feeCc} CC) refunded.` : 'No fee charged.'}`,
      );
    }

    // ── Step 3: Record outgoing transaction ──────────────────────────────
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
  @Get('offers')
  async listOffers(@Req() req: AuthedReq) {
    try {
      const user = await this.users.findById(req.user.userId);
      if (!user?.username || !user.cantonPartyId) {
        return { offers: [], message: 'No wallet found.' };
      }

      if (user.cantonPartyId.startsWith('canquest:')) {
        return { offers: [], message: 'Party ID is still a placeholder.' };
      }

      if (!this.splice.isConfigured) {
        return { offers: [], message: 'Splice validator not configured.' };
      }

      const walletUsername =
        (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
        user.username;

      const rawOffers = await this.splice.listTransferOffers(walletUsername);

      const filtered = rawOffers.filter((o) => {
        const p = o.payload as Record<string, unknown> | undefined;
        if (!p) return false;
        const receiver = typeof p.receiver === 'string'
          ? p.receiver
          : (p.receiver as Record<string, string> | undefined)?.id ?? '';
        return receiver && (
          receiver === user.cantonPartyId ||
          receiver.startsWith(`${walletUsername}::`)
        );
      });

      const offers = filtered.map((o) => {
        const p = o.payload as Record<string, unknown>;
        const amount = p?.amount as Record<string, unknown> | undefined;
        const amountStr = typeof amount?.unassigned === 'string'
          ? amount.unassigned
          : typeof amount?.qty === 'string'
            ? amount.qty
            : '0';
        return {
          contractId: o.contractId,
          sender: typeof p?.sender === 'string' ? p.sender : 'unknown',
          receiver: typeof p?.receiver === 'string' ? p.receiver : 'unknown',
          amountCc: (parseFloat(amountStr) || 0) / 1_000_000,
          description: typeof p?.description === 'string' ? p.description : '',
          trackingId: typeof p?.trackingId === 'string' ? p.trackingId : '',
        };
      });

      return { offers, count: offers.length };
    } catch (err) {
      this.logger.warn(`listOffers error for user ${req.user.userId.slice(0, 8)}: ${String(err)}`);
      return { offers: [], message: 'Could not fetch offers. Splice tunnel may be down.' };
    }
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
