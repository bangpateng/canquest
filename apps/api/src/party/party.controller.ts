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
import { PrismaService } from '../prisma/prisma.service';
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
    return { requiresInviteCode: true, hasRedeemedInvite };
  }

  // ── wallet create / allocate / preapproval ──
  // (unchanged — skipped for brevity, same as previous version)

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('username')
  async setUsername(@Req() req: AuthedReq, @Body() body: SetUsernameDto) {
    const username = normalizeWalletUsername(body.username) ?? '';
    if (username.length < 3) throw new BadRequestException('Username must be at least 3 characters.');
    const existing = await this.users.findById(req.user.userId);
    if (!existing) throw new BadRequestException('User not found');
    if (hasRealWallet(existing.cantonPartyId)) throw new ConflictException('You already have a wallet.');
    const taken = await this.users.findByUsernameInsensitive(username);
    if (taken && taken.id !== req.user.userId) throw new ConflictException('Party ID Already Taken');

    let cantonPartyId: string;
    let isPlaceholder = false;
    let spliceOnboarded = false;
    const needsInviteFlow = !hasRealWallet(existing.cantonPartyId);
    const inviteCode = body.walletInviteCode;
    if (needsInviteFlow) await this.walletInvites.assertCanCreateWallet(req.user.userId, inviteCode);

    try {
      const splicePartyId = await this.splice.createWalletUser(username);
      if (!splicePartyId && (await this.splice.getUserPartyId(username))) throw new ConflictException('Party ID Already Taken');
      if (splicePartyId) { cantonPartyId = splicePartyId; spliceOnboarded = true; }
      else {
        const ledgerReachable = await this.ledger.isReachable();
        if (ledgerReachable) {
          try { cantonPartyId = await this.ledger.allocateParty(username); }
          catch { cantonPartyId = `canquest:user:${username}:${req.user.userId.slice(0, 8)}`; isPlaceholder = true; }
        } else { cantonPartyId = `canquest:user:${username}:${req.user.userId.slice(0, 8)}`; isPlaceholder = true; }
      }

      const partyOwner = await this.users.findByPartyId(cantonPartyId);
      if (partyOwner && partyOwner.id !== req.user.userId) throw new ConflictException('Party ID Already Taken');
      if (!isPlaceholder) this.assertPartyOnValidatorParticipant(cantonPartyId);

      try { await this.users.setPartyId(req.user.userId, cantonPartyId, username); cantonPartyId = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId; }
      catch (err: unknown) { if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') throw new ConflictException('Party ID Already Taken'); throw err; }

      if (needsInviteFlow) {
        if (!isPlaceholder) { await this.walletInvites.redeemAfterWalletCreated(req.user.userId, inviteCode); await this.walletInvites.recordAllocation({ userId: req.user.userId, username, partyId: cantonPartyId }); }
        else await this.walletInvites.releaseReservation(req.user.userId, inviteCode);
      }

      void this.featuredActivity.recordActivity('wallet_created', cantonPartyId, `Wallet created for @${username}`).catch(() => {});
      let preapprovalActive = false;
      if (spliceOnboarded) { const ex = await this.splice.hasTransferPreapproval(cantonPartyId); preapprovalActive = ex ? true : (await this.splice.createTransferPreapproval(username)).ok; }

      if (!isPlaceholder && needsInviteFlow) {
        void this.questLedger.recordPartyRegistration({ userPartyId: cantonPartyId, username, inviteCode: inviteCode ?? '', spliceOnboarded, preapprovalActive }).catch(() => {});
      }

      return { username, cantonPartyId, isPlaceholder, spliceOnboarded, preapproval: { active: preapprovalActive }, message: spliceOnboarded ? (preapprovalActive ? 'Wallet created.' : 'Wallet created.') : 'Wallet created.' };
    } catch (err) {
      if (needsInviteFlow) await this.walletInvites.releaseReservation(req.user.userId, inviteCode);
      throw err;
    }
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('ensure-preapproval')
  async ensurePreapproval(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) throw new BadRequestException('Create your wallet first.');
    if (user.cantonPartyId.startsWith('canquest:')) throw new BadRequestException('Party ID still placeholder.');
    const preferredUsername = spliceWalletUsernameFromParty(user.cantonPartyId) ?? normalizeWalletUsername(user.username);
    if (!preferredUsername) throw new BadRequestException('Could not resolve wallet username.');
    let walletUsername = (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ?? preferredUsername;
    if (!(await this.splice.canAccessWalletAs(walletUsername))) {
      const onboard = await this.splice.ensureSpliceWalletUser(preferredUsername, user.cantonPartyId);
      if (!onboard.ok) throw new BadRequestException(onboard.detail ?? 'Wallet not in Splice.');
      walletUsername = onboard.username ?? preferredUsername;
    }
    const existing = await this.splice.hasTransferPreapproval(user.cantonPartyId);
    if (existing) return { active: true, partyId: user.cantonPartyId, username: walletUsername, message: 'Already active.' };
    const created = await this.splice.createTransferPreapproval(walletUsername);
    if (!created.ok) throw new BadRequestException((created.detail ?? 'Failed') + `. Balance: ${await this.splice.getUserBalance(walletUsername) ?? 0} CC`);
    return { active: true, partyId: user.cantonPartyId, username: walletUsername, message: 'Preapproval active.' };
  }

  @SkipThrottle() @Get('preapproval-status')
  async preapprovalStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId) return { hasWallet: false, preapproval: { active: false }, message: 'No wallet.' };
    const [preapprovals] = await Promise.all([this.splice.getTransferPreapprovals(user.cantonPartyId), Promise.resolve(user.cantonPartyId.startsWith('canquest:'))]);
    return { hasWallet: true, partyId: user.cantonPartyId, preapproval: { active: preapprovals.length > 0 } };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } }) @Post('allocate')
  async allocateCantonParty(@Req() req: AuthedReq, @Body() body: AllocateWalletDto) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found');
    if (hasRealWallet(user.cantonPartyId)) throw new ConflictException('Already have wallet.');
    const username = normalizeWalletUsername(user.username) ?? `cq-${user.id.slice(0, 10)}`;
    const needsInviteFlow = !hasRealWallet(user.cantonPartyId);
    const inviteCode = body.walletInviteCode;
    if (needsInviteFlow) await this.walletInvites.assertCanCreateWallet(req.user.userId, inviteCode);
    try {
      const splicePartyId = await this.splice.createWalletUser(username);
      if (!splicePartyId && (await this.splice.getUserPartyId(username))) throw new ConflictException('Party ID Already Taken');
      if (splicePartyId) {
        this.assertPartyOnValidatorParticipant(splicePartyId);
        await this.users.setPartyId(req.user.userId, splicePartyId, username);
        const storedPartyId = normalizeCantonPartyId(splicePartyId) ?? splicePartyId;
        if (needsInviteFlow) { await this.walletInvites.redeemAfterWalletCreated(user.id, inviteCode); await this.walletInvites.recordAllocation({ userId: user.id, username, partyId: storedPartyId }); }
        return { cantonPartyId: storedPartyId, isPlaceholder: false, spliceOnboarded: true, message: 'Wallet created.' };
      }
      const cantonPartyId = await this.ledger.allocateParty(username);
      await this.users.setPartyId(req.user.userId, cantonPartyId, user.username ?? undefined);
      const storedPartyId = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId;
      if (needsInviteFlow) { await this.walletInvites.redeemAfterWalletCreated(user.id, inviteCode); await this.walletInvites.recordAllocation({ userId: user.id, username, partyId: storedPartyId }); }
      return { cantonPartyId: storedPartyId, isPlaceholder: false, spliceOnboarded: false, message: 'Party allocated.' };
    } catch (err) { if (needsInviteFlow) await this.walletInvites.releaseReservation(req.user.userId, inviteCode); throw err; }
  }

  @SkipThrottle() @Get('balance')
  async getBalance(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username) return { balance: null };
    const display = await this.ccBalance.getDisplayBalance(user.id, user.username, user.cantonPartyId);
    return { username: user.username, balance: display.balance, unit: 'CC', source: display.source, stale: display.stale, updatedAt: display.updatedAt?.toISOString() ?? null };
  }

  @SkipThrottle() @Get('fee-config') getFeeConfig() { return { feeCc: Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5'), ccUsdPrice: Number(this.config.get<string>('CC_USD_PRICE') ?? '0') }; }

  // ── SEND CC ──────────────────────────────────────────────────────────────────

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } })
  @Post('send-cc')
  async sendCc(@Req() req: AuthedReq, @Body() body: { recipientUsername: string; amount: number; memo?: string }) {
    const sender = await this.users.findById(req.user.userId);
    if (!sender?.username || !sender.cantonPartyId) throw new BadRequestException('Create wallet first.');

    const amount = Number(body.amount);
    if (!amount || amount <= 0) throw new BadRequestException('Amount must be > 0.');

    const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5');
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';

    const recipientInput = body.recipientUsername?.trim();
    if (!recipientInput) throw new BadRequestException('Recipient required.');

    let recipientPartyId: string;
    let recipientLabel: string;
    let recipientUsername: string | null = null;

    if (looksLikeCantonPartyId(recipientInput)) {
      const normalizedRecipient = normalizeCantonPartyId(recipientInput);
      if (!normalizedRecipient) throw new BadRequestException('Invalid Party ID format.');
      if (cantonPartyIdsEqual(normalizedRecipient, sender.cantonPartyId)) throw new BadRequestException('Cannot send to yourself.');
      recipientPartyId = normalizedRecipient;
      recipientLabel = normalizedRecipient.split('::')[0] ?? normalizedRecipient;
      const found = await this.users.findByPartyId(normalizedRecipient);
      recipientUsername = found?.username?.toLowerCase() ?? (recipientLabel || null);
    } else {
      const username = recipientInput.replace(/^@/, '').toLowerCase();
      if (username === sender.username?.toLowerCase()) throw new BadRequestException('Cannot send to yourself.');
      const dbUser = await this.users.findByUsernameInsensitive(username);
      const resolved = dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
      if (!resolved) throw new BadRequestException(`User "@${username}" not found.`);
      recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
      recipientLabel = `@${username}`;
      recipientUsername = dbUser?.username?.toLowerCase() ?? username;
    }

    const description = body.memo?.trim() || `Sent to ${recipientLabel}`;

    const senderBalance = await this.splice.getUserBalance(sender.username);
    if (senderBalance !== null && senderBalance < amount + feeCc) throw new BadRequestException(`Insufficient balance. Need ${amount + feeCc} CC.`);

    // Step 1: Create TransferOffer
    const offerContractId = await this.splice.createTransferOffer(recipientPartyId, amount, description, undefined, sender.username);
    if (!offerContractId) throw new BadRequestException('Could not create offer.');

    // Step 2: Decide auto-accept or external
    const isSameParticipant = participantSuffixesMatch(recipientPartyId, sender.cantonPartyId ?? undefined);

    let accepted = false;
    let acceptUpdateId: string | null = null;
    let transferTransactionId: string | undefined;
    let externalOffer = false;

    if (isSameParticipant && recipientUsername) {
      accepted = await this.splice.acceptOfferViaWallet(offerContractId, recipientUsername);
      if (!accepted) { const lr = await this.ledger.acceptTransferOffer(offerContractId, recipientPartyId); accepted = lr.accepted; acceptUpdateId = lr.updateId; }
      this.logger.log(`CC transfer: ${sender.username} -> ${recipientLabel} ${amount} CC accepted=${accepted}`);
    } else if (!isSameParticipant) {
      externalOffer = true;
      this.logger.log(`CC transfer (External): ${sender.username} -> ${recipientLabel} ${amount} CC. Offer ${offerContractId.slice(0, 16)}... pending recipient acceptance.`);
    } else {
      const result = await this.ledger.acceptTransferOffer(offerContractId, recipientPartyId);
      accepted = result.accepted; acceptUpdateId = result.updateId;
    }

    if (accepted) {
      const outRow = await this.users.recordTransaction({ userId: sender.id, amountCc: amount, type: 'TRANSFER_OUT', description, counterparty: recipientPartyId, ledgerTxId: offerContractId, cantonUpdateId: acceptUpdateId ?? undefined });
      transferTransactionId = outRow.id;
      if (sender.cantonPartyId) void this.txDetail.backfillUpdateId(outRow.id, offerContractId, sender.cantonPartyId);
      void this.featuredActivity.recordActivity('cc_transfer', sender.cantonPartyId!, `CC transfer ${amount} CC to ${recipientLabel}`).catch(() => {});

      let recipientUser = recipientUsername ? await this.users.findByUsernameInsensitive(recipientUsername) : null;
      if (!recipientUser) recipientUser = await this.users.findByPartyId(recipientPartyId);
      if (recipientUser) {
        const inRow = await this.users.recordTransaction({ userId: recipientUser.id, amountCc: amount, type: 'TRANSFER_IN', description: `Received from @${sender.username}${body.memo ? ': ' + body.memo.trim() : ''}`, counterparty: normalizeCantonPartyId(sender.cantonPartyId!) ?? sender.cantonPartyId!, ledgerTxId: offerContractId, cantonUpdateId: acceptUpdateId ?? undefined });
        if (recipientUser.cantonPartyId) void this.txDetail.backfillUpdateId(inRow.id, offerContractId, recipientUser.cantonPartyId);
        if (recipientUser.username) void this.inboundSync.alignBalanceFromChain(recipientUser.id, recipientUser.username);
      }
      if (sender.username) void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
    }

    if (!accepted && !externalOffer) throw new BadRequestException('Transfer failed.');

    // Record external offer to DB so it shows in "Pending Sent Offers"
    if (externalOffer) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "CcExternalOffer" ("id","userId","contractId","recipientParty","recipientLabel","amountCc","description","status","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::double precision,$7,'pending',NOW(),NOW()) ON CONFLICT ("contractId") DO NOTHING`,
        offerContractId.slice(0, 30), sender.id, offerContractId, recipientPartyId, recipientLabel, amount, description,
      );
      await this.users.recordTransaction({ userId: sender.id, amountCc: amount, type: 'TRANSFER_OUT', description, counterparty: recipientPartyId, ledgerTxId: offerContractId });
      if (sender.username) void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
    }

    // Platform fee
    let feeCollected = false; let feeWarning: string | undefined;
    if (feeCc > 0 && validatorPartyId && sender.username) {
      const feeResult = await this.splice.collectPlatformFee({ senderUsername: sender.username, feeCc, description: `Platform fee for transfer to ${recipientLabel}` });
      feeCollected = feeResult.collected;
      if (feeCollected) {
        await this.users.recordTransaction({ userId: sender.id, amountCc: feeCc, type: 'TRANSFER_OUT', description: `Platform fee (transfer to ${recipientLabel})`, counterparty: normalizeCantonPartyId(feeResult.treasuryPartyId ?? validatorPartyId) ?? (feeResult.treasuryPartyId ?? validatorPartyId), ledgerTxId: feeResult.ledgerTxId });
        if (sender.username) void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);
      } else { feeWarning = `Fee (${feeCc} CC) could not be collected.`; }
    }

    const totalDeducted = amount + (feeCollected ? feeCc : 0);
    const message = externalOffer
      ? `Offer sent to ${recipientLabel}. Recipient must accept from their wallet.${feeCollected ? ` (fee ${feeCc} CC)` : ''}`
      : `Sent ${amount} CC to ${recipientLabel}${feeCollected ? ` (fee ${feeCc} CC)` : ''}.`;

    return { success: true, from: sender.username, to: recipientLabel, amount, fee: feeCc, feeCollected, totalDeducted, accepted: externalOffer ? null : true, external: externalOffer || undefined, message, transactionId: transferTransactionId, ...(feeWarning ? { warning: feeWarning } : {}) };
  }

  // ── Pending Sent Offers ──────────────────────────────────────────────────────

  @SkipThrottle() @Get('sent-offers')
  async getSentOffers(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found.');
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; contractId: string; recipientParty: string; recipientLabel: string; amountCc: number; description: string; status: string; createdAt: string }[]>(`SELECT id, "contractId", "recipientParty", "recipientLabel", "amountCc", description, status, "createdAt" FROM "CcExternalOffer" WHERE "userId" = $1 AND status = 'pending' ORDER BY "createdAt" DESC`, user.id);
    return { offers: rows };
  }

  @Throttle({ ledger: { limit: 10, ttl: 60_000 } }) @Post('cancel-offer')
  async cancelOffer(@Req() req: AuthedReq, @Body() body: { offerId: string }) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new BadRequestException('User not found.');
    await this.prisma.$executeRawUnsafe(`UPDATE "CcExternalOffer" SET status = 'cancelled', "updatedAt" = NOW(), "cancelledAt" = NOW() WHERE id = $1 AND "userId" = $2`, body.offerId, user.id);
    // Try to cancel on-chain via Canton Ledger API (best-effort)
    const rows = await this.prisma.$queryRawUnsafe<{ contractId: string }[]>(`SELECT "contractId" FROM "CcExternalOffer" WHERE id = $1`, body.offerId);
    if (rows.length > 0) {
      void this.ledger.exerciseChoice(rows[0].contractId, '94d88246f69d8a4b69333d1f993e3280deaca19b70511ea7687f01e4328a34a4:Splice.Wallet.TransferOffer:TransferOffer', 'TransferOffer_Cancel', {}, [user.cantonPartyId!]).catch(() => {});
    }
    return { cancelled: true };
  }

  // ── Notifications / History ──────────────────────────────────────────────────

  @SkipThrottle() @Get('notifications') async getNotifications(@Req() req: AuthedReq, @Query('limit') limit?: string) { const user = await this.users.findById(req.user.userId); if (!user) throw new BadRequestException('User not found.'); const n = Math.min(30, Math.max(1, parseInt(limit ?? '12', 10) || 12)); return this.users.getNotifications(user.id, n); }
  @SkipThrottle() @Post('notifications/seen') async markNotificationsSeen(@Req() req: AuthedReq) { const user = await this.users.findById(req.user.userId); if (!user) throw new BadRequestException('User not found.'); return this.users.markNotificationsSeen(user.id); }
  @SkipThrottle() @Get('transactions') async getTransactions(@Req() req: AuthedReq, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const user = await this.users.findById(req.user.userId); if (!user) throw new BadRequestException('User not found.'); const p = Math.max(1, parseInt(page ?? '1', 10) || 1); const ps = Math.min(20, Math.max(1, parseInt(pageSize ?? '5', 10) || 5)); return this.users.getTransactions(user.id, p, ps); }
  @SkipThrottle() @Get('transactions/:id') async getTransactionById(@Req() req: AuthedReq, @Param('id') id: string) { return this.txDetail.getDetailForUser(req.user.userId, id.trim()); }
  @SkipThrottle() @Get('ledger-status') async ledgerStatus() { const [canton, splice] = await Promise.all([this.ledger.isReachable(), this.splice.isReachable()]); return { canton: { reachable: canton }, splice: { reachable: splice, configured: this.splice.isConfigured }, message: canton && splice ? 'Node connected.' : 'Node connection issue' }; }
}