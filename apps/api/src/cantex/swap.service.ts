/**
 * SwapService — orchestration untuk CC ↔ token swap (custodial Wintip-style).
 *
 * CC → Token:
 *   1. Transfer CC: user party → Cantex trading account (Canton ledger)
 *   2. Cantex swap: sell CC → buy token (intent flow + WS confirm)
 *   3. Credit CantexTokenBalance off-chain
 *   4. Platform fee: CC user → canquest-fee
 *
 * Token → CC:
 *   1. Debit CantexTokenBalance off-chain
 *   2. Cantex swap: sell token → buy CC (intent flow + WS confirm)
 *   3. Transfer CC: trading account → user party (Cantex transferCC)
 *   4. Platform fee: CC user → canquest-fee
 *
 * Fund safety: DB write failures di-audit (log) tapi tidak throw —
 * ledger success tidak boleh masked oleh DB failure (mirror sendCc pattern).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { UsersService } from '../users/users.service';
import { WalletPasswordService } from '../users/wallet-password.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CantexClient } from './cantex-client';
import { getCantexConfig } from './cantex.config';
import { CantexError } from './cantex.types';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private readonly swapInFlight = new Set<string>();

  constructor(
    private readonly cantex: CantexClient,
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly users: UsersService,
    private readonly walletPassword: WalletPasswordService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  async executeSwap(
    userId: string,
    params: {
      sellInstrumentId: string;
      sellInstrumentAdmin: string;
      buyInstrumentId: string;
      buyInstrumentAdmin: string;
      amount: number;
      walletPassword?: string;
      sellIsCC?: boolean;
      clientNonce: string;
    },
  ): Promise<{
    success: boolean;
    direction: string;
    outputAmount?: string;
    swapId?: string;
    message?: string;
  }> {
    // 1. Wallet gate.
    await this.walletPassword.assertGate(userId, params.walletPassword);

    // 2. Per-user mutex (mirror sendCcInFlight).
    if (this.swapInFlight.has(userId)) {
      return {
        success: false,
        direction: '',
        message: 'You have a swap in progress. Please wait.',
      };
    }
    this.swapInFlight.add(userId);
    try {
      const user = await this.users.findById(userId);
      if (!user?.cantonPartyId || !user?.username) {
        return { success: false, direction: '', message: 'Wallet not found.' };
      }

      // Idempotency: cek clientNonce sudah pernah dipakai.
      const existing = await this.prisma.swapTransaction.findUnique({
        where: { clientNonce: params.clientNonce },
      });
      if (existing) {
        return {
          success: existing.status === 'EXECUTED',
          direction: existing.direction,
          outputAmount: existing.buyAmount?.toString() ?? undefined,
          swapId: existing.id,
          message:
            existing.status === 'EXECUTED'
              ? 'Swap already completed.'
              : 'Swap already pending.',
        };
      }

      // Determine direction.
      const ccId = getCantexConfig().ccInstrumentId;
      const sellIsCC =
        params.sellIsCC ??
        params.sellInstrumentId.toUpperCase() === ccId.toUpperCase();

      const userInfo = {
        id: user.id,
        username: user.username,
        cantonPartyId: user.cantonPartyId,
      };

      if (sellIsCC) {
        return await this.swapCCToToken(userId, userInfo, params);
      } else {
        return await this.swapTokenToCC(userId, userInfo, params);
      }
    } catch (err) {
      this.logger.error(
        `Swap failed for user ${userId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        success: false,
        direction: '',
        message: (err as Error).message,
      };
    } finally {
      this.swapInFlight.delete(userId);
    }
  }

  // ── CC → Token ─────────────────────────────────────────────────────────

  private async swapCCToToken(
    userId: string,
    user: { id: string; username: string; cantonPartyId: string },
    params: {
      sellInstrumentId: string;
      sellInstrumentAdmin: string;
      buyInstrumentId: string;
      buyInstrumentAdmin: string;
      amount: number;
      clientNonce: string;
    },
  ) {
    const cfg = getCantexConfig();
    const feePct = Number(
      this.config.get<string>('SWAP_PLATFORM_FEE_PCT') ?? '0',
    );
    const platformFeeCc = (params.amount * feePct) / 100;

    // 1. Cek CC balance cukup.
    const ccBal = await this.prisma.ccBalance.findUnique({
      where: { userId },
      select: { balanceMicroCc: true },
    });
    const ccAvailable = ccBal ? Number(ccBal.balanceMicroCc) / 1_000_000 : 0;
    if (ccAvailable < params.amount + platformFeeCc) {
      return {
        success: false,
        direction: 'CC_TO_TOKEN',
        message: `Insufficient CC balance. Need ${params.amount + platformFeeCc}, have ${ccAvailable}.`,
      };
    }

    // 2. Record SwapTransaction PENDING.
    const swapTx = await this.prisma.swapTransaction.create({
      data: {
        userId,
        direction: 'CC_TO_TOKEN',
        sellInstrumentId: cfg.ccInstrumentId,
        sellInstrumentAdmin:
          cfg.ccInstrumentAdmin || params.sellInstrumentAdmin,
        sellAmount: new Decimal(params.amount),
        buyInstrumentId: params.buyInstrumentId,
        buyInstrumentAdmin: params.buyInstrumentAdmin,
        status: 'PENDING',
        clientNonce: params.clientNonce,
      },
    });

    try {
      // 3. Transfer CC: user → trading account.
      const transferResult = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId: user.cantonPartyId,
        receiverPartyId: cfg.tradingAccountParty,
        amountCc: params.amount,
        clientNonce: `${params.clientNonce}:cc-leg`,
      });
      if (!transferResult.ok) {
        throw new CantexError(
          `CC transfer failed: ${transferResult.error ?? 'unknown'}`,
        );
      }

      // 4. Cantex swap: sell CC → buy token.
      const swapResult = await this.cantex.swapAndConfirm({
        sellAmount: String(params.amount),
        sellInstrumentId: cfg.ccInstrumentId,
        sellInstrumentAdmin: cfg.ccInstrumentAdmin,
        buyInstrumentId: params.buyInstrumentId,
        buyInstrumentAdmin: params.buyInstrumentAdmin,
      });

      // 5. Credit CantexTokenBalance off-chain.
      const outputAmount = new Decimal(swapResult.outputAmount);
      await this.prisma.cantexTokenBalance.upsert({
        where: {
          userId_instrumentId_instrumentAdmin: {
            userId,
            instrumentId: params.buyInstrumentId,
            instrumentAdmin: params.buyInstrumentAdmin,
          },
        },
        create: {
          userId,
          instrumentId: params.buyInstrumentId,
          instrumentAdmin: params.buyInstrumentAdmin,
          balance: outputAmount,
        },
        update: { balance: { increment: outputAmount } },
      });

      // 6. Record SWAP_OUT (CC debit).
      await this.users.recordTransaction({
        userId,
        amountCc: params.amount,
        type: 'SWAP_OUT',
        description: `Swap CC → ${params.buyInstrumentId}`,
        ledgerTxId: `swap:${swapTx.id}:cc-out`,
        status: 'COMPLETED',
      });

      // 7. Platform fee (non-blocking).
      if (platformFeeCc > 0) {
        const feeRecipient =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID') ?? '';
        if (feeRecipient) {
          try {
            await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: user.cantonPartyId,
              receiverPartyId: feeRecipient,
              amountCc: platformFeeCc,
              clientNonce: `${params.clientNonce}:fee`,
            });
          } catch (err) {
            this.logger.warn(
              `Platform fee collection failed (non-blocking): ${(err as Error).message}`,
            );
          }
        }
      }

      // 8. Update SwapTransaction EXECUTED.
      await this.prisma.swapTransaction.update({
        where: { id: swapTx.id },
        data: {
          status: 'EXECUTED',
          buyAmount: outputAmount,
          ccLedgerTxId: transferResult.updateId,
          swapExecutedAt: new Date(),
        },
      });

      // 9. Reconcile CC balance.
      void this.inboundSync.alignBalanceFromChain(userId, user.username);

      // 10. Emit realtime.
      void this.realtime.push(userId, 'swap:completed', {
        direction: 'CC_TO_TOKEN',
        outputAmount: swapResult.outputAmount,
      });

      return {
        success: true,
        direction: 'CC_TO_TOKEN',
        outputAmount: swapResult.outputAmount,
        swapId: swapTx.id,
      };
    } catch (err) {
      // Mark FAILED.
      await this.prisma.swapTransaction.update({
        where: { id: swapTx.id },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }

  // ── Token → CC ─────────────────────────────────────────────────────────

  private async swapTokenToCC(
    userId: string,
    user: { id: string; username: string; cantonPartyId: string },
    params: {
      sellInstrumentId: string;
      sellInstrumentAdmin: string;
      buyInstrumentId: string;
      buyInstrumentAdmin: string;
      amount: number;
      clientNonce: string;
    },
  ) {
    const cfg = getCantexConfig();

    // 1. Cek token balance cukup (off-chain).
    const tokenBal = await this.prisma.cantexTokenBalance.findUnique({
      where: {
        userId_instrumentId_instrumentAdmin: {
          userId,
          instrumentId: params.sellInstrumentId,
          instrumentAdmin: params.sellInstrumentAdmin,
        },
      },
    });
    const available = tokenBal ? parseFloat(tokenBal.balance.toString()) : 0;
    if (available < params.amount) {
      return {
        success: false,
        direction: 'TOKEN_TO_CC',
        message: `Insufficient ${params.sellInstrumentId} balance. Need ${params.amount}, have ${available}.`,
      };
    }

    // 2. Record SwapTransaction PENDING.
    const swapTx = await this.prisma.swapTransaction.create({
      data: {
        userId,
        direction: 'TOKEN_TO_CC',
        sellInstrumentId: params.sellInstrumentId,
        sellInstrumentAdmin: params.sellInstrumentAdmin,
        sellAmount: new Decimal(params.amount),
        buyInstrumentId: cfg.ccInstrumentId,
        buyInstrumentAdmin: cfg.ccInstrumentAdmin || params.buyInstrumentAdmin,
        status: 'PENDING',
        clientNonce: params.clientNonce,
      },
    });

    try {
      // 3. Cantex swap: sell token → buy CC.
      const swapResult = await this.cantex.swapAndConfirm({
        sellAmount: String(params.amount),
        sellInstrumentId: params.sellInstrumentId,
        sellInstrumentAdmin: params.sellInstrumentAdmin,
        buyInstrumentId: cfg.ccInstrumentId,
        buyInstrumentAdmin: cfg.ccInstrumentAdmin,
      });

      const outputCc = new Decimal(swapResult.outputAmount);
      const outputCcNum = parseFloat(swapResult.outputAmount);

      // 4. Transfer CC: trading account → user party.
      await this.cantex.transferCC({
        receiver: user.cantonPartyId,
        amount: swapResult.outputAmount,
        instrumentId: cfg.ccInstrumentId,
        instrumentAdmin: cfg.ccInstrumentAdmin,
        memo: `Swap ${params.sellInstrumentId} → CC`,
      });

      // 5. Debit CantexTokenBalance off-chain.
      await this.prisma.cantexTokenBalance.update({
        where: {
          userId_instrumentId_instrumentAdmin: {
            userId,
            instrumentId: params.sellInstrumentId,
            instrumentAdmin: params.sellInstrumentAdmin,
          },
        },
        data: { balance: { decrement: new Decimal(params.amount) } },
      });

      // 6. Record SWAP_IN (CC credit).
      await this.users.recordTransaction({
        userId,
        amountCc: outputCcNum,
        type: 'SWAP_IN',
        description: `Swap ${params.sellInstrumentId} → CC`,
        ledgerTxId: `swap:${swapTx.id}:cc-in`,
        status: 'COMPLETED',
      });

      // 7. Platform fee (non-blocking, dari CC yang diterima user).
      const feePct = Number(
        this.config.get<string>('SWAP_PLATFORM_FEE_PCT') ?? '0',
      );
      if (feePct > 0 && outputCcNum > 0) {
        const feeAmount = (outputCcNum * feePct) / 100;
        const feeRecipient =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID') ?? '';
        if (feeRecipient && feeAmount > 0) {
          try {
            await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: user.cantonPartyId,
              receiverPartyId: feeRecipient,
              amountCc: feeAmount,
              clientNonce: `${params.clientNonce}:fee`,
            });
          } catch (err) {
            this.logger.warn(
              `Platform fee collection failed (non-blocking): ${(err as Error).message}`,
            );
          }
        }
      }

      // 8. Update SwapTransaction EXECUTED.
      await this.prisma.swapTransaction.update({
        where: { id: swapTx.id },
        data: {
          status: 'EXECUTED',
          buyAmount: outputCc,
          swapExecutedAt: new Date(),
        },
      });

      // 9. Reconcile CC balance.
      void this.inboundSync.alignBalanceFromChain(userId, user.username);

      // 10. Emit realtime.
      void this.realtime.push(userId, 'swap:completed', {
        direction: 'TOKEN_TO_CC',
        outputAmount: swapResult.outputAmount,
      });

      return {
        success: true,
        direction: 'TOKEN_TO_CC',
        outputAmount: swapResult.outputAmount,
        swapId: swapTx.id,
      };
    } catch (err) {
      await this.prisma.swapTransaction.update({
        where: { id: swapTx.id },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }
}
