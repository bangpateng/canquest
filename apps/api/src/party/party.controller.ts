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
import {
  cantonPartyIdsEqual,
  looksLikeCantonPartyId,
  normalizeCantonPartyId,
  normalizeWalletUsername,
} from '../common/canton-party-id';
import { hasRealWallet } from '../common/wallet-policy';
import { UsersService } from '../users/users.service';
import { WalletQuotaService } from './wallet-quota.service';
import { CantonPartyBindingDto } from './dto/canton-party-binding.dto';
import { SetUsernameDto } from './dto/set-username.dto';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('party')
@UseGuards(AuthGuard('jwt'))
@Throttle({ ledger: { limit: 30, ttl: 60_000 } }) // semua ledger ops: 30/mnt
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
    private readonly walletQuota: WalletQuotaService,
  ) {}

  @Get('wallet-quota')
  @SkipThrottle()
  walletQuotaStatus() {
    return this.walletQuota.getStatus();
  }

  /**
   * Reserve a username → create Splice wallet user (allocates Party ID + registers in Splice).
   * Single API call to the Splice validator does everything.
   * Falls back to Canton JSON API only, or placeholder, if Splice is unreachable.
   */
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

    if (!hasRealWallet(existing.cantonPartyId)) {
      await this.walletQuota.assertSlotAvailable();
    }

    // Preferred path: Splice validator handles party allocation + onboarding in one call.
    const splicePartyId = await this.splice.createWalletUser(username);
    if (!splicePartyId && (await this.splice.getUserPartyId(username))) {
      throw new ConflictException('Party ID Already Taken');
    }

    if (splicePartyId) {
      cantonPartyId = splicePartyId;
      spliceOnboarded = true;
    } else {
      // Fallback: allocate party on Canton JSON API only (not visible in Splice explorer yet).
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

    if (!hasRealWallet(existing.cantonPartyId) && !isPlaceholder) {
      await this.walletQuota.recordAllocation({
        userId: req.user.userId,
        username,
        partyId: cantonPartyId,
      });
    }

    // Emit FeaturedAppActivityMarker for wallet creation
    // Per Canton Module 4: wallet_created is a meaningful user action
    // https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker
    void this.featuredActivity
      .recordActivity('wallet_created', cantonPartyId, `Wallet created for @${username}`)
      .catch(() => { /* non-critical */ });

    // CIP-56 compliance: auto-create TransferPreapproval so the user can receive
    // CC transfers directly without a manual step. This is a best-effort call —
    // the offer/accept flow still works even if preapproval creation fails.
    // See: https://docs.canton.network/appdev/modules/m7-canton-coin-preapprovals
    let preapprovalActive = false;
    if (spliceOnboarded) {
      // First check if one already exists (e.g. re-generating wallet)
      const existing = await this.splice.hasTransferPreapproval(cantonPartyId);
      if (existing) {
        preapprovalActive = true;
      } else {
        preapprovalActive = (await this.splice.createTransferPreapproval(username)).ok;
      }
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
  }

  /**
   * Check TransferPreapproval status for the current user.
   * A TransferPreapproval (Splice.AmuletRules:TransferPreapproval) enables
   * any party to send CC directly to this user without offer/accept.
   *
   * Users create their preapproval once via the Splice Wallet UI:
   *   1. Visit your Splice Wallet UI (same domain as your validator)
   *   2. Click the "Create Preapproval" button (top-right, next to logout)
   *   3. Approve the transaction — this burns a small CC fee ($1/year)
   *   4. After that, all incoming CC transfers go through automatically
   */
  /**
   * Enable or refresh TransferPreapproval (CIP-56) for the logged-in user.
   * Required for direct CC transfers from the validator wallet without manual accept.
   */
  @Post('ensure-preapproval')
  async ensurePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username || !user.cantonPartyId) {
      throw new BadRequestException('Create your wallet first from the Wallet page.');
    }
    if (user.cantonPartyId.startsWith('canquest:')) {
      throw new BadRequestException(
        'Party ID is still a placeholder. Run POST /party/allocate when the Splice tunnel is active.',
      );
    }

    const existing = await this.splice.hasTransferPreapproval(user.cantonPartyId);
    if (existing) {
      return {
        active: true,
        partyId: user.cantonPartyId,
        username: user.username,
        message: 'TransferPreapproval is already active (CIP-56).',
      };
    }

    const created = await this.splice.createTransferPreapproval(user.username);
    if (!created.ok) {
      const balance = await this.splice.getUserBalance(user.username);
      const hint =
        balance === null || balance <= 0
          ? ' You need a minimum CC balance for the preapproval fee (~$1/year). Fund your wallet from the validator wallet UI first.'
          : '';
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
      username: user.username,
      message:
        'TransferPreapproval active — CC from the validator wallet can arrive directly (CIP-56).',
    };
  }

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

  /**
   * Retry wallet creation — calls Splice validator to allocate + register.
   * Use this if Generate Wallet previously resulted in a placeholder.
   */
  @Post('allocate')
  async allocateCantonParty(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found');

    if (hasRealWallet(user.cantonPartyId)) {
      throw new ConflictException(
        'You already have a wallet. Only one wallet is allowed per account.',
      );
    }

    const username =
      normalizeWalletUsername(user.username) ?? `cq-${user.id.slice(0, 10)}`;

    if (!hasRealWallet(user.cantonPartyId)) {
      await this.walletQuota.assertSlotAvailable();
    }

    // Try Splice first (preferred — full registration).
    const splicePartyId = await this.splice.createWalletUser(username);
    if (!splicePartyId && (await this.splice.getUserPartyId(username))) {
      throw new ConflictException('Party ID Already Taken');
    }
    if (splicePartyId) {
      const partyOwner = await this.users.findByPartyId(splicePartyId);
      if (partyOwner && partyOwner.id !== req.user.userId) {
        throw new ConflictException('Party ID Already Taken');
      }
      await this.users.setPartyId(req.user.userId, splicePartyId, user.username ?? undefined);
      const storedPartyId = normalizeCantonPartyId(splicePartyId) ?? splicePartyId;
      if (!hasRealWallet(user.cantonPartyId)) {
        await this.walletQuota.recordAllocation({
          userId: user.id,
          username,
          partyId: storedPartyId,
        });
      }
      // CIP-56: ensure TransferPreapproval exists for this user
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

    // Fallback: Canton JSON API only.
    const cantonPartyId = await this.ledger.allocateParty(username);
    await this.users.setPartyId(req.user.userId, cantonPartyId, user.username ?? undefined);
    const storedPartyId = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId;
    if (!hasRealWallet(user.cantonPartyId)) {
      await this.walletQuota.recordAllocation({
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
  }

  /**
   * Manually save a Party ID — use when allocating via Canton Console / CLI.
   */
  @Post('canton-binding')
  async bindCantonParty(@Req() req: AuthedReq, @Body() body: CantonPartyBindingDto) {
    const cantonPartyId = body.cantonPartyId.trim();
    await this.users.setPartyId(req.user.userId, cantonPartyId);
    return {
      cantonPartyId,
      isPlaceholder: false,
      message: 'Canton Party ID saved manually. No ledger validation was performed.',
    };
  }

  /**
   * CC balance: PostgreSQL snapshot first (fast), Splice sync in background.
   * See BALANCE_READ_FROM_DB in apps/api/.env.example.
   */
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

  /**
   * Send CC reward to the authenticated user (auto-accept via backend).
   *
   * Flow:
   *   1. Validator creates TransferOffer → user's party
   *   2. Backend immediately accepts it as the user (canActAs)
   *   3. Validator's wallet automation delivers CC
   *
   * Note: In production, this endpoint should require admin privileges.
   * For testing purposes it's self-callable.
   */
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

    // Step 1: Create transfer offer from validator → user
    const offerContractId = await this.splice.createTransferOffer(
      user.cantonPartyId,
      body.amount,
      body.description ?? 'CanQuest reward',
    );

    if (!offerContractId) {
      throw new BadRequestException('Failed to create transfer offer. Check Splice Validator connection.');
    }

    // Step 2: Auto-accept menggunakan Splice Wallet API (port 8080) sebagai receiver
    // Menggunakan actAs = user.username sesuai pola CIP-56 Propose-Accept
    const accepted = await this.splice.acceptOfferViaWallet(offerContractId, user.username);

    if (accepted) {
      const row = await this.users.recordTransaction({
        userId: user.id,
        amountCc: body.amount,
        type: 'TRANSFER_IN',
        description: body.description ?? 'CanQuest reward',
        counterparty: 'Validator (reward)',
        ledgerTxId: offerContractId,
      });
      if (user.cantonPartyId) {
        void this.txDetail.backfillUpdateId(row.id, offerContractId, user.cantonPartyId);
      }
    }

    if (!accepted) {
      throw new BadRequestException(
        'Reward transfer failed — offer was not accepted. No transaction was recorded.',
      );
    }

    return {
      offerContractId,
      accepted: true,
      amount: body.amount,
      message: `${body.amount} CC sent to ${user.username}. It should appear in your wallet shortly.`,
    };
  }

  /**
   * User-to-user CC transfer with platform fee.
   *
   * Flow:
   *   1. Create TransferOffer from sender → recipient (main transfer)
   *   2. Auto-accept on behalf of recipient
   *   3. Create TransferOffer from sender → validator (fee)
   *   4. Auto-accept fee on behalf of validator
   */
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

    // Resolve recipient: jika ada '::' berarti Party ID langsung, kalau tidak cari by username
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
      recipientPartyId =
        normalizeCantonPartyId(resolved) ?? resolved;
      recipientLabel = `@${username}`;
      recipientUsername = dbUser?.username?.toLowerCase() ?? username;
    }

    const description = body.memo?.trim() || `Sent to ${recipientLabel}`;

    const senderBalance = await this.splice.getUserBalance(sender.username);
    if (senderBalance !== null && senderBalance < amount + feeCc) {
      throw new BadRequestException(
        `Insufficient balance. Need ${amount + feeCc} CC (${amount} transfer + ${feeCc} platform fee).`,
      );
    }

    // ── Step 1 (Propose): Buat TransferOffer dari pengirim → penerima ──────────
    // actAs = sender.username (sesuai CIP-56 Propose-Accept)
    const offerContractId = await this.splice.createTransferOffer(
      recipientPartyId,
      amount,
      description,
      undefined,
      sender.username,
    );
    if (!offerContractId) {
      throw new BadRequestException(
        'Transfer failed — could not create offer. Check your CC balance.',
      );
    }

    // ── Step 2 (Accept): Auto-accept menggunakan Splice Wallet API (port 8080) ─
    // Jika penerima adalah user CanQuest → pakai acceptOfferViaWallet (actAs = recipientUsername)
    // Jika penerima eksternal (tidak punya username) → fallback ke Canton Ledger API (port 7575)
    let accepted = false;
    let acceptUpdateId: string | null = null;
    let transferTransactionId: string | undefined;
    if (recipientUsername) {
      accepted = await this.splice.acceptOfferViaWallet(offerContractId, recipientUsername);
      this.logger.log(
        `CC transfer (Wallet API): ${sender.username} → ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
      );
    } else {
      const result = await this.ledger.acceptTransferOffer(offerContractId, recipientPartyId);
      accepted = result.accepted;
      acceptUpdateId = result.updateId;
      this.logger.log(
        `CC transfer (Ledger API): ${sender.username} → ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
      );
    }

    if (accepted) {
      const outRow = await this.users.recordTransaction({
        userId: sender.id,
        amountCc: amount,
        type: 'TRANSFER_OUT',
        description: description,
        counterparty: recipientPartyId,
        ledgerTxId: offerContractId,
        cantonUpdateId: acceptUpdateId ?? undefined,
      });
      transferTransactionId = outRow.id;
      if (!acceptUpdateId && sender.cantonPartyId) {
        void this.txDetail.backfillUpdateId(outRow.id, offerContractId, sender.cantonPartyId);
      }

      // Emit FeaturedAppActivityMarker for CC transfer
      if (sender.cantonPartyId) {
        void this.featuredActivity
          .recordActivity('cc_transfer', sender.cantonPartyId, `CC transfer ${amount} CC to ${recipientLabel}`)
          .catch(() => { /* non-critical */ });
      }

      let recipientUser = recipientUsername
        ? await this.users.findByUsernameInsensitive(recipientUsername)
        : null;
      if (!recipientUser) {
        recipientUser = await this.users.findByPartyId(recipientPartyId);
      }
      if (recipientUser) {
        const inRow = await this.users.recordTransaction({
          userId: recipientUser.id,
          amountCc: amount,
          type: 'TRANSFER_IN',
          description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
          counterparty:
            normalizeCantonPartyId(sender.cantonPartyId) ?? sender.cantonPartyId,
          ledgerTxId: offerContractId,
          cantonUpdateId: acceptUpdateId ?? undefined,
        });
        if (recipientUser.cantonPartyId) {
          void this.txDetail.backfillUpdateId(
            inRow.id,
            offerContractId,
            recipientUser.cantonPartyId,
          );
        }
        if (recipientUser.username) {
          void this.inboundSync.alignBalanceFromChain(
            recipientUser.id,
            recipientUser.username,
          );
        }
      }
      if (sender.username) {
        void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
      }
    }

    if (!accepted) {
      throw new BadRequestException(
        'Transfer failed — offer was not accepted. No transaction was recorded in your history.',
      );
    }

    let feeCollected = false;
    let feeWarning: string | undefined;
    if (feeCc > 0 && validatorPartyId && sender.username) {
      const feeAcceptUsername =
        this.config.get<string>('CANTON_FEE_ACCEPT_USERNAME')?.trim() ||
        this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() ||
        'administrator';

      let treasuryPartyId =
        this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
        this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
        validatorPartyId;

      const walletParty = await this.splice.getWalletPartyId(feeAcceptUsername);
      if (walletParty && walletParty !== treasuryPartyId) {
        this.logger.warn(
          `Fee party mismatch: .env treasury=${treasuryPartyId.split('::')[0]} but Splice user ${feeAcceptUsername} → ${walletParty.split('::')[0]}. Using wallet party.`,
        );
        treasuryPartyId = walletParty;
      } else if (!this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID') && walletParty) {
        treasuryPartyId = walletParty;
      }

      const feeResult = await this.splice.collectPlatformFee({
        senderUsername: sender.username,
        feeCc,
        description: `Platform fee for transfer to ${recipientLabel}`,
        treasuryPartyId,
        treasuryAcceptUsername: feeAcceptUsername,
      });

      feeCollected = feeResult.collected;
      if (feeCollected) {
        const feeRow = await this.users.recordTransaction({
          userId: sender.id,
          amountCc: feeCc,
          type: 'TRANSFER_OUT',
          description: `Platform fee (transfer to ${recipientLabel})`,
          counterparty: normalizeCantonPartyId(treasuryPartyId) ?? treasuryPartyId,
          ledgerTxId: feeResult.ledgerTxId,
        });
        if (feeResult.ledgerTxId && sender.cantonPartyId) {
          void this.txDetail.backfillUpdateId(
            feeRow.id,
            feeResult.ledgerTxId,
            sender.cantonPartyId,
          );
        }
        await this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
        this.logger.log(
          `Fee collected (${feeResult.method ?? 'unknown'}): ${sender.username} → ${treasuryPartyId.split('::')[0]} ${feeCc} CC`,
        );
      } else {
        feeWarning = `Transfer succeeded but platform fee (${feeCc} CC) could not be collected.`;
        this.logger.warn(
          `Fee failed for ${sender.username}: ${feeResult.error ?? 'unknown'} (treasury ${treasuryPartyId.split('::')[0]})`,
        );
      }
    }

    const totalDeducted = amount + (feeCollected ? feeCc : 0);
    const message = feeCollected
      ? `Sent ${amount} CC to ${recipientLabel} (platform fee ${feeCc} CC).`
      : feeWarning
        ? `Sent ${amount} CC to ${recipientLabel}. ${feeWarning}`
        : `Sent ${amount} CC to ${recipientLabel}.`;

    return {
      success: true,
      from: sender.username,
      to: recipientLabel,
      amount,
      fee: feeCc,
      feeCollected,
      totalDeducted,
      accepted: true,
      message,
      transactionId: transferTransactionId,
      ...(feeWarning ? { warning: feeWarning } : {}),
    };
  }

  /**
   * Paginated CC transaction history for the authenticated user.
   * GET /api/party/transactions?page=1&pageSize=5
   */
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
   * Internal transaction explorer — DB summary + optional on-chain events.
   * GET /api/party/transactions/:id
   */
  @Get('transactions/:id')
  async getTransactionById(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.txDetail.getDetailForUser(req.user.userId, id.trim());
  }

  /**
   * Kembalikan konfigurasi fee transaksi dari env.
   * Frontend menggunakan ini agar tampilan fee selalu sinkron dengan nilai di .env.
   * GET /api/party/fee-config
   */
  @Get('fee-config')
  getFeeConfig() {
    return {
      feeCc: Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5'),
      ccUsdPrice: Number(this.config.get<string>('CC_USD_PRICE') ?? '0'),
    };
  }

  /** Check reachability of Canton JSON Ledger API and Splice Validator API. */
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
        ? 'Both Canton JSON API and Splice Validator API are reachable.'
        : !canton
          ? 'Canton JSON API NOT reachable. Check CANTON_JSON_API_URL and SSH tunnel to port 7575.'
          : 'Canton OK. Splice Validator API not reachable — check CANTON_VALIDATOR_URL (port 5003 tunnel).',
    };
  }

}
