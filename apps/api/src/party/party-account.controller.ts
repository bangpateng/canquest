/**
 * Read-only user: notifications, transactions, fee-config, ledger-status.
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { TransactionDetailService } from '../canton/transaction-detail.service';
import { UsersService } from '../users/users.service';
import type { AuthedReq } from './party-shared';

/** Read-only user: notifications, transactions, fee-config, ledger-status. Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyAccountController {
  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly txDetail: TransactionDetailService,
    private readonly config: ConfigService,
  ) {}

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
    // Unified feed: CcTransaction + TokenTransaction digabung. Sebelumnya hanya
    // baca CcTransaction, sehingga transfer token non-CC (USDCx) tak pernah tampil.
    return this.users.getUnifiedActivity(user.id, p, ps);
  }

  @SkipThrottle()
  @Get('transactions/:id')
  async getTransactionById(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.txDetail.getDetailForUser(req.user.userId, id.trim());
  }

  @SkipThrottle()
  @Get('fee-config')
  getFeeConfig() {
    // Token non-CC yang toggle preapproval-nya ENABLED di Settings (fungsional).
    // CC selalu enabled. Token di list ini = toggle bisa diklik. Token lain =
    // tampil tapi "Coming soon" (disabled).
    const enabledTokensStr =
      this.config.get<string>('PREAPPROVAL_ENABLED_TOKENS') ?? '';
    const preapprovalEnabledTokens = enabledTokensStr
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    return {
      feeCc: Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? '5'),
      ccUsdPrice: Number(this.config.get<string>('CC_USD_PRICE') ?? '0'),
      // CC always enabled; non-CC dari env.
      preapprovalTokens: ['CC', ...preapprovalEnabledTokens],
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
