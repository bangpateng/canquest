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
      `Party participant mismatch: got ...${got?.slice(-16) ?? '?'} expected ...${expected?.slice(-16) ?? '?'}`,
    );
    throw new BadRequestException(
      'Wallet was created on the wrong Canton participant (suffix after :: does not match your TestNet validator). ' +
        'Both SSH tunnels must target the same validator stack on 162.250.190.204: ' +
        '7575 -> participant container, 8080 -> nginx (wallet.localhost). ' +
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
      .catch(() => {});

    let preapprovalActive = false;
    if (spliceOnboarded) {
      const existing = await this.splice.hasTransferPreapproval(cantonPartyId);
      if (existing) {
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
        ? 'Wallet created -- Party ID registered. Direct CC transfers enabled (CIP-56 compliant).'
        : 'Wallet created -- Party ID registered. CC transfers work via offer/accept flow.';
    } else if (!isPlaceholder) {
      message =
        'Party ID allocated on Canton participant. Splice validator not reachable (set CANTON_VALIDATOR_URL) -- wallet not yet visible in explorer.';
    } else {
      message =
        'Saved with placeholder -- both Canton JSON API and Splice validator unreachable. Start your SSH tunnels (7575 + 8080) and re-generate from the Wallet page.';
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
          ? ` On-chain balance for @${walletUsername} is ${chainBalance ?? 0} CC -- need funds for the preapproval fee (~$1/year). UI balance may be a DB snapshot.`
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
        'TransferPreapproval active -- CC from the validator wallet can arrive directly (CIP-56).',
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
          ? `Preapproval active -- direct CC transfers enabled. Expires: ${preapprovals[0]?.expiresAt ?? 'unknown'}`
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
          ? 'Wallet created -- Party ID registered. Direct CC transfers enabled (CIP-56 compliant).'
          : 'Wallet created -- Party ID allocated and registered in Splice validator.',
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

    const offerContractId = await this.splice.createTransferOffer(
      user.cantonPartyId,
      body.amount,
      body.description ?? 'CanQuest reward',
    );

    if (!offerContractId) {
      throw new BadRequestException('Failed to create transfer offer. Check Splice Validator connection.');
    }

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
        'Reward transfer failed -- offer was not accepted. No transaction was recorded.',
      );
    }

    return {
      offerContractId,
      accepted: true,
      amount: body.amount,
      message: `${body.amount} CC sent to ${user.username}. It should appear in your wallet shortly.`,
    };
  }

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

    const offerContractId = await this.splice.createTransferOffer(
      recipientPartyId,
      amount,
      description,
      undefined,
      sender.username,
    );
    if (!offerContractId) {
      throw new BadRequestException(
        'Transfer failed -- could not create offer. Check your CC balance.',
      );
    }

    let accepted = false;
    let acceptUpdateId: string | null = null;
    let transferTransactionId: string | undefined;
    if (recipientUsername) {
      accepted = await this.splice.acceptOfferViaWallet(offerContractId, recipientUsername);
      this.logger.log(
        `CC transfer (Wallet API): ${sender.username} -> ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
      );
    } else {
      const result = await this.ledger.acceptTransferOffer(offerContractId, recipientPartyId);
      accepted = result.accepted;
      acceptUpdateId = result.updateId;
      this.logger.log(
        `CC transfer (Ledger API): ${sender.username} -> ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
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

      if (sender.cantonPartyId) {
        void this.featuredActivity
          .recordActivity('cc_transfer', sender.cantonPartyId, `CC transfer ${amount} CC to ${recipientLabel}`)
          .catch(() => {});
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
        'Transfer failed -- offer was not accepted. No transaction was recorded in your history.',
      );
    }

    let feeCollected = false;
    let feeWarning: string | undefined;
    let feeLedgerTxId: string | undefined;
    if (feeCc > 0 && validatorPartyId && sender.username) {
      const feeResult = await this.splice.collectPlatformFee({
        senderUsername: sender.username,
        feeCc,
        description: `Platform fee for transfer to ${recipientLabel}`,
      });

      feeCollected = feeResult.collected;
      feeLedgerTxId = feeResult.ledgerTxId;
      const feeTreasuryPartyId = feeResult.treasuryPartyId ?? validatorPartyId;
      if (feeCollected) {
        const feeRow = await this.users.recordTransaction({
          userId: sender.id,
          amountCc: feeCc,
          type: 'TRANSFER_OUT',
          description: `Platform fee (transfer to ${recipientLabel})`,
          counterparty:
            normalizeCantonPartyId(feeTreasuryPartyId) ?? feeTreasuryPartyId,
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
          `Fee collected (${feeResult.method ?? 'unknown'}): ${sender.username} -> ${feeTreasuryPartyId.split('::')[0]} ${feeCc} CC`,
        );
      } else {
        feeWarning = `Transfer succeeded but platform fee (${feeCc} CC) could not be collected.`;
        this.logger.warn(
          `Fee failed for ${sender.username}: ${feeResult.error ?? 'unknown'} (treasury ${feeTreasuryPartyId.split('::')[0]})`,
        );
      }
    }

    const totalDeducted = amount + (feeCollected ? feeCc : 0);
    const message = feeCollected
      ? `Sent ${amount} CC to ${recipientLabel} (platform fee ${feeCc} CC).`
      : feeWarning
        ? `Sent ${amount} CC to ${recipientLabel}. ${feeWarning}`
        : `Sent ${amount} CC to ${recipientLabel}.`;

    if (sender.cantonPartyId && accepted) {
      void this.questLedger
        .recordCcTransfer({
          senderPartyId: sender.cantonPartyId,
          recipientPartyId,
          amountCc: amount,
          feeCc: feeCollected ? feeCc : 0,
          totalDeductedCc: totalDeducted,
          memo: body.memo?.trim(),
          transferTxId: offerContractId,
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
      message,
      transactionId: transferTransactionId,
      ...(feeWarning ? { warning: feeWarning } : {}),
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

  @SkipThrottle()
  @Get('transfer-offers')
  async listTransferOffers(@Req() req: AuthedReq) {
    try {
      const user = await this.users.findById(req.user.userId);
      if (!user?.cantonPartyId || !user.username) {
        return { offers: [] };
      }

      const walletUsername =
        (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
        user.username;

      const offers = await this.splice.listTransferOffers(walletUsername);

      const normalizedUserParty = normalizeCantonPartyId(user.cantonPartyId)
        ?? user.cantonPartyId;

      const incoming = offers
        .filter((offer) => {
          const payload = offer.payload as Record<string, unknown> | undefined;
          const receiver = typeof payload?.receiver_party_id === 'string'
            ? payload.receiver_party_id
            : null;
          if (!receiver) return false;
          return cantonPartyIdsEqual(receiver, normalizedUserParty);
        })
        .map((offer) => {
          const payload = (offer.payload ?? {}) as Record<string, unknown>;
          const senderPartyId = (typeof payload.sender_party_id === 'string'
            ? payload.sender_party_id
            : '') as string;
          return {
            contractId: offer.contractId,
            senderParty: senderPartyId,
            senderUsername: senderPartyId.split('::')[0] ?? senderPartyId,
            amount: String(payload.amount ?? '0'),
            description: String(payload.description ?? ''),
            expiresAtMicros: String(payload.expires_at ?? '0'),
            createdAt: typeof payload.created_at === 'string'
              ? payload.created_at
              : undefined,
            incoming: true,
          };
        });

      return { offers: incoming };
    } catch {
      return { offers: [] };
    }
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
    if (!user?.cantonPartyId || !user.username) {
      throw new BadRequestException('Create your wallet first.');
    }

    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ??
      user.username;

    const accepted = await this.splice.acceptOfferViaWalletWithRetry(
      contractId,
      walletUsername,
      { attempts: 5, delayMs: 1500 },
    );

    if (!accepted) {
      const ledgerResult = await this.ledger.acceptTransferOffer(
        contractId,
        user.cantonPartyId,
      );
      if (!ledgerResult.accepted) {
        throw new BadRequestException(
          'Failed to accept transfer offer. The offer may have expired or already been processed.',
        );
      }
    }

    return {
      accepted: true,
      contractId,
      message: 'Transfer offer accepted. CC will arrive in your wallet shortly.',
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
        ? 'Both Canton JSON API and Splice Validator API are reachable.'
        : !canton
          ? 'Canton JSON API NOT reachable. Check CANTON_JSON_API_URL and SSH tunnel to port 7575.'
          : 'Canton OK. Splice Validator API not reachable -- check CANTON_VALIDATOR_URL (port 5003 tunnel).',
    };
  }

}