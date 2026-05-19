import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

import { CantonLedgerService } from '../canton/canton-ledger.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
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
    private readonly config: ConfigService,
  ) {}

  /**
   * Reserve a username → create Splice wallet user (allocates Party ID + registers in Splice).
   * Single API call to the Splice validator does everything.
   * Falls back to Canton JSON API only, or placeholder, if Splice is unreachable.
   */
  @Post('username')
  async setUsername(@Req() req: AuthedReq, @Body() body: SetUsernameDto) {
    const taken = await this.users.findByUsername(body.username);
    if (taken && taken.id !== req.user.userId) {
      throw new ConflictException('Username already taken');
    }

    let cantonPartyId: string;
    let isPlaceholder = false;
    let spliceOnboarded = false;

    // Preferred path: Splice validator handles party allocation + onboarding in one call.
    const splicePartyId = await this.splice.createWalletUser(body.username);

    if (splicePartyId) {
      cantonPartyId = splicePartyId;
      spliceOnboarded = true;
    } else {
      // Fallback: allocate party on Canton JSON API only (not visible in Splice explorer yet).
      const ledgerReachable = await this.ledger.isReachable();
      if (ledgerReachable) {
        try {
          cantonPartyId = await this.ledger.allocateParty(body.username);
        } catch {
          cantonPartyId = `canquest:user:${body.username}:${req.user.userId.slice(0, 8)}`;
          isPlaceholder = true;
        }
      } else {
        cantonPartyId = `canquest:user:${body.username}:${req.user.userId.slice(0, 8)}`;
        isPlaceholder = true;
      }
    }

    await this.users.setPartyId(req.user.userId, cantonPartyId, body.username);

    // CIP-56 compliance: auto-create TransferPreapproval so the user can receive
    // CC transfers directly without a manual step. This is a best-effort call —
    // the offer/accept flow still works even if preapproval creation fails.
    let preapprovalActive = false;
    if (spliceOnboarded) {
      // First check if one already exists (e.g. re-generating wallet)
      const existing = await this.splice.hasTransferPreapproval(cantonPartyId);
      if (existing) {
        preapprovalActive = true;
      } else {
        preapprovalActive = await this.splice.createTransferPreapproval(body.username);
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
      username: body.username,
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

    const username = user.username ?? `cq-${user.id.slice(0, 10)}`;

    // Try Splice first (preferred — full registration).
    const splicePartyId = await this.splice.createWalletUser(username);
    if (splicePartyId) {
      await this.users.setPartyId(req.user.userId, splicePartyId, user.username ?? undefined);
      // CIP-56: ensure TransferPreapproval exists for this user
      const preapprovalActive = await this.splice.createTransferPreapproval(username);
      return {
        cantonPartyId: splicePartyId,
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
    return {
      cantonPartyId,
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
   * Get the current CC balance for the authenticated user from the Splice Wallet API.
   */
  @Get('balance')
  async getBalance(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.username) {
      return { balance: null, message: 'No wallet found. Create your wallet first.' };
    }
    const balance = await this.splice.getUserBalance(user.username);
    return { username: user.username, balance, unit: 'CC' };
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

    void this.users.recordTransaction({
      userId: user.id,
      amountCc: body.amount,
      type: 'TRANSFER_IN',
      description: body.description ?? 'CanQuest reward',
      counterparty: 'Validator (reward)',
      ledgerTxId: offerContractId,
    });

    return {
      offerContractId,
      accepted,
      amount: body.amount,
      message: accepted
        ? `${body.amount} CC dikirim ke ${user.username}. CC akan tiba di wallet sebentar lagi.`
        : `Offer dibuat tapi auto-accept gagal — coba lagi atau cek koneksi Splice.`,
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

    if (recipientInput.includes('::')) {
      if (recipientInput === sender.cantonPartyId) {
        throw new BadRequestException('You cannot send CC to yourself.');
      }
      recipientPartyId = recipientInput;
      recipientLabel = recipientInput.split('::')[0] ?? recipientInput;
      // Cari username dari DB, kalau tidak ada fallback ke bagian sebelum '::' di Party ID
      // (di Splice, bagian sebelum '::' adalah username/hint yang sama dengan JWT sub)
      const found = await this.users.findByPartyId(recipientPartyId);
      recipientUsername = found?.username ?? (recipientInput.split('::')[0] || null);
    } else {
      const username = recipientInput.replace(/^@/, '').toLowerCase();
      if (username === sender.username?.toLowerCase()) {
        throw new BadRequestException('You cannot send CC to yourself.');
      }
      const resolved = await this.splice.getUserPartyId(username);
      if (!resolved) {
        throw new BadRequestException(`User "@${username}" not found or has no wallet.`);
      }
      recipientPartyId = resolved;
      recipientLabel = `@${username}`;
      recipientUsername = username;
    }

    const description = body.memo?.trim() || `Sent to ${recipientLabel}`;

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
        'Transfer gagal — tidak bisa membuat offer. Periksa saldo CC Anda.',
      );
    }

    // ── Step 2 (Accept): Auto-accept menggunakan Splice Wallet API (port 8080) ─
    // Jika penerima adalah user CanQuest → pakai acceptOfferViaWallet (actAs = recipientUsername)
    // Jika penerima eksternal (tidak punya username) → fallback ke Canton Ledger API (port 7575)
    let accepted = false;
    if (recipientUsername) {
      accepted = await this.splice.acceptOfferViaWallet(offerContractId, recipientUsername);
      this.logger.log(
        `CC transfer (Wallet API): ${sender.username} → ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
      );
    } else {
      const result = await this.ledger.acceptTransferOffer(offerContractId, recipientPartyId);
      accepted = result.accepted;
      this.logger.log(
        `CC transfer (Ledger API): ${sender.username} → ${recipientLabel} ${amount} CC (accepted: ${String(accepted)})`,
      );
    }

    // Catat riwayat transaksi
    void this.users.recordTransaction({
      userId: sender.id,
      amountCc: amount,
      type: 'TRANSFER_OUT',
      description: description,
      counterparty: recipientLabel,
      ledgerTxId: offerContractId,
    });

    // Catat TRANSFER_IN untuk penerima jika adalah user CanQuest
    const recipientUser = recipientUsername
      ? await this.users.findByUsername(recipientUsername)
      : null;
    if (recipientUser) {
      void this.users.recordTransaction({
        userId: recipientUser.id,
        amountCc: amount,
        type: 'TRANSFER_IN',
        description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
        counterparty: `@${sender.username}`,
        ledgerTxId: offerContractId,
      });
    }

    // ── Step 2: Platform fee sender → validator (async, tidak memblokir respons) ─
    if (feeCc > 0 && validatorPartyId) {
      const validatorAdminUser =
        this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER') ?? 'administrator';
      void (async () => {
        const feeOfferId = await this.splice.createTransferOffer(
          validatorPartyId,
          feeCc,
          `Platform fee for transfer to ${recipientLabel}`,
          undefined,
          sender.username ?? undefined,
        );
        if (feeOfferId) {
          const ok = await this.splice.acceptOfferViaWallet(feeOfferId, validatorAdminUser);
          this.logger.log(`Fee collected: ${sender.username ?? 'unknown'} → validator ${feeCc} CC (accepted: ${String(ok)})`);
        } else {
          this.logger.warn(`Fee offer creation failed for ${sender.username ?? 'unknown'} — skipping fee.`);
        }
      })();
    }

    return {
      success: true,
      from: sender.username,
      to: recipientLabel,
      amount,
      fee: feeCc,
      totalDeducted: amount + feeCc,
      accepted,
      message: accepted
        ? `${amount} CC sent to ${recipientLabel}. Platform fee: ${feeCc} CC. Total deducted: ${amount + feeCc} CC.`
        : `Offer created but auto-accept failed — recipient needs to accept from their wallet.`,
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
