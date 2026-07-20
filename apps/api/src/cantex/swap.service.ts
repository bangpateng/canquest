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
import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { UsersService } from '../users/users.service';
import { WalletPasswordService } from "../users/wallet-password.service";
import { RealtimeService } from '../realtime/realtime.service';
import { CantexClient } from './cantex-client';
import type { SwapExecutedDetails } from './cantex-client';
import { getCantexConfig } from './cantex.config';
import { CantexError, CantexTimeoutError } from './cantex.types';

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

  /** Promise-based sleep helper. */
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Generate Request ID pendek (8 karakter hex) untuk identifikasi unik per
   * swap di memo (BUG P3.1 fix).
   *
   * Sebelumnya memo statis `canquest-swap|${userPartyId}|${tokenId}` — kalau
   * user swap 2x cepat untuk token yang sama, tidak ada cara membedakan
   * transaksi mana yang mana (di Cantex ledger / log / DB). Dengan ID unik
   * per swap, korrelasi end-to-end jadi possible.
   *
   * Format: 8 hex chars (32-bit entropy, cukup untuk swap dalam window waktu).
   * Diambil dari segmen pertama randomUUID() (yang sudah punya entropy tinggi).
   */
  private generateSwapRequestId(): string {
    return randomUUID().split('-')[0];
  }

  /**
   * BUG-K.2 fix: catat kegagalan pemotongan fee platform ke PendingDelivery
   * dengan status khusus `FEE_PENDING` supaya bisa di-reconcile oleh admin
   * (cron-job fee collection atau manual intervention).
   *
   * Sebelumnya, fee transfer yang gagal hanya di-log `warn` (non-blocking) →
   * platform rugi diam-diam tanpa jejak di DB. Swap tetap sukses dari sisi
   * user (token sudah diberikan, tidak adil fail swap), tapi fee yang bocor
   * WAJIB ter-catat agar bisa di-recover.
   *
   * Status `FEE_PENDING` adalah tambahan baru (schema PendingDelivery.status
   * free-text String, tidak butuh migrasi). Token dicatat sebagai CC/Amulet
   * karena fee selalu dalam CC.
   *
   * Non-fatal: gagal catat PendingDelivery hanya di-log error (sudah best
   * effort) — tidak boleh mask swap success.
   */
  private async recordFeePending(params: {
    swapTxId: string;
    userId: string;
    userPartyId: string;
    feeAmountCc: number;
    feeRecipientPartyId: string;
    clientNonceSuffix: string;
    errorMessage: string;
  }): Promise<void> {
    const feeMicroCc = BigInt(Math.round(params.feeAmountCc * 1_000_000));
    try {
      await this.prisma.pendingDelivery.create({
        data: {
          userId: params.userId,
          swapTransactionId: params.swapTxId,
          userPartyId: params.userPartyId,
          // Fee selalu dalam CC/Amulet (instrument CanQuest operator).
          tokenId: getCantexConfig().ccInstrumentId,
          tokenAdmin: getCantexConfig().ccInstrumentAdmin,
          amount: new Decimal(params.feeAmountCc),
          amountMicroCc: feeMicroCc,
          status: 'FEE_PENDING',
          transferKind: 'direct',
          errorMessage:
            `Platform fee (${params.feeAmountCc} CC) not collected — ` +
            `intended recipient ${params.feeRecipientPartyId}, ` +
            `clientNonce suffix ${params.clientNonceSuffix}. ` +
            `Original error: ${params.errorMessage}`,
        },
      });
      this.logger.error(
        `FEE_PENDING recorded for swap ${params.swapTxId}: ${params.feeAmountCc} CC fee not collected. Needs admin reconcile. Original error: ${params.errorMessage}`,
      );
    } catch (pdErr) {
      // Worst case: fee bocor DAN PendingDelivery gagal catat. Log error
      // eksplisit supaya muncul di alert monitoring.
      this.logger.error(
        `CRITICAL: fee collection failed AND PendingDelivery record failed for swap ${params.swapTxId}. ` +
          `Fee ${params.feeAmountCc} CC lost without DB trace. PendingDelivery error: ${(pdErr as Error).message}. ` +
          `Original fee error: ${params.errorMessage}`,
      );
    }
  }

  /**
   * Swap dengan retry backoff untuk error "balance not enough" / "holding
   * balance" / "insufficient" (mirror Wintip retry logic: 3 attempts, backoff
   * 8s lalu 16s). Memberi waktu konsolidasi on-chain settle sebelum retry.
   *
   * Non-balance error (auth, network timeout, dll) langsung throw tanpa retry.
   */
  private async swapWithRetry(
    params: {
      sellAmount: string;
      sellInstrumentId: string;
      sellInstrumentAdmin: string;
      buyInstrumentId: string;
      buyInstrumentAdmin: string;
      maxNetworkFee?: string;
    },
    maxRetries = 3,
  ): Promise<SwapExecutedDetails> {
    const delays = [0, 8_000, 16_000]; // 0s, 8s, 16s (mirror Wintip)
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.log(
            `Swap retry attempt ${attempt + 1}/${maxRetries} after ${delays[attempt]}ms...`,
          );
          await this.sleep(delays[attempt]);
        }
        return await this.cantex.swapAndConfirm(params);
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message.toLowerCase();
        // Hanya retry bila balance/holding-related (kemungkinan lag settle).
        const isBalanceErr =
          msg.includes('balance') ||
          msg.includes('holding') ||
          msg.includes('insufficient');
        if (isBalanceErr && attempt < maxRetries - 1) {
          this.logger.warn(
            `Swap failed (balance-related), will retry: ${(err as Error).message}`,
          );
          continue;
        }
        throw err; // non-balance error atau retry exhausted → throw
      }
    }
    throw lastErr;
  }

  /**
   * Slippage + minimum safety gate (pre-execution).
   * Ambil fresh quote dari Cantex, tolak swap bila:
   *   - Slippage > MAX_SLIPPAGE_PCT (default 15%) — proteksi user dari price impact ekstrim
   *   - Sell amount < SAFE_MIN_SWAP_CC (default 1 CC) — minimum ticket size (CC_TO_TOKEN only)
   *
   * Mengembalikan { ok: true } bila lolos, { ok: false, message } bila ditolak.
   *
   * FAIL-CLOSED (BUG-D.1 fix): bila fresh quote tidak bisa di-fetch, TOLAK swap
   * (ok:false) daripada lanjut tanpa proteksi. Sebelumnya fail-open — user bisa
   * dapat harga sangat buruk saat API quote down tanpa peringatan. Membatalkan
   * swap lebih aman: user bisa retry saat quote sehat.
   */
  private async checkSlippageGate(params: {
    sellAmount: string;
    sellInstrumentId: string;
    sellInstrumentAdmin: string;
    buyInstrumentId: string;
    buyInstrumentAdmin: string;
    minAmountCc?: number;
    /** Minimum amount untuk TOKEN_TO_CC (mis. 2.5 USDCx). */
    minAmountToken?: number;
    /** Instrument id token yang dijual (untuk pesan error yang informatif). */
    minAmountTokenSymbol?: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const maxSlippage = Number(
      this.config.get<string>('MAX_SLIPPAGE_PCT') ?? '15',
    );
    const safeMinCc = Number(
      this.config.get<string>('SAFE_MIN_SWAP_CC') ?? '1',
    );
    const safeMinToken = Number(
      this.config.get<string>('SAFE_MIN_SWAP_TOKEN') ?? '2.5',
    );

    // Minimum amount gate (CC_TO_TOKEN only).
    if (params.minAmountCc !== undefined && params.minAmountCc < safeMinCc) {
      return {
        ok: false,
        message: `Minimum swap amount is ${safeMinCc} CC.`,
      };
    }

    // Minimum amount gate (TOKEN_TO_CC only).
    if (
      params.minAmountToken !== undefined &&
      params.minAmountToken < safeMinToken
    ) {
      const symbol = params.minAmountTokenSymbol ?? 'token';
      return {
        ok: false,
        message: `Minimum swap amount is ${safeMinToken} ${symbol}.`,
      };
    }

    // Slippage gate via fresh quote.
    try {
      const quote = await this.cantex.getQuote({
        sellAmount: params.sellAmount,
        sellInstrumentId: params.sellInstrumentId,
        sellInstrumentAdmin: params.sellInstrumentAdmin,
        buyInstrumentId: params.buyInstrumentId,
        buyInstrumentAdmin: params.buyInstrumentAdmin,
      });
      const slippage = parseFloat(quote.prices.slippage.toString());
      if (!isNaN(slippage) && slippage > maxSlippage) {
        return {
          ok: false,
          message: `Price impact too high (${slippage.toFixed(1)}% > ${maxSlippage}% limit). Try a smaller amount or try again later.`,
        };
      }
    } catch (err) {
      // FAIL-CLOSED (BUG-D.1): quote tidak bisa di-fetch → tidak ada proteksi
      // slippage → TOLAK swap. Sebelumnya fail-open (return ok:true) yang
      // berarti user bisa dapat harga sangat buruk saat API quote down tanpa
      // peringatan. Log error (bukan warn) supaya kasus ini terlihat di
      // monitoring sebagai anomali yang perlu investigasi.
      this.logger.error(
        `Slippage gate FAIL-CLOSED: quote fetch failed, swap ditolak: ${(err as Error).message}`,
      );
      return {
        ok: false,
        message:
          'Unable to verify current swap price. Please try again in a moment.',
      };
    }
    return { ok: true };
  }

  /**
   * Coba deliver token (non-CC) on-chain ke user party via Cantex transferCC
   * (Wintip-style). Untuk CC/Amulet, skip — CC delivery pakai executeTransferFactoryTransfer.
   *
   * ⚠️ LIMITATION BUG-C (P3.4): Saat ini, endpoint Cantex
   * `/v1/ledger/transaction/build/transfer` (yang dipanggil transferCC) HANYA
   * support CC/Amulet. Untuk non-CC (USDCx, CBTC, dll), Cantex return 400
   * `ledger_transaction_build_transfer_failed`. Akibatnya token asli non-CC
   * tetap nangkring di shared trading account Cantex CanQuest, sementara user
   * hanya dapat angka off-chain di CantexTokenBalance.
   *
   * TODO: Non-CC on-chain delivery endpoint not yet available in Cantex client.
   *   - Investigasi: apakah perlu TransferFactory CIP-56 (Canton Ledger side,
   *     bukan Cantex REST), atau endpoint Cantex khusus non-CC.
   *   - Pertanyaan terbuka untuk AI Canton (per CANQUEST_FLOW_AUDIT.md §18 P1-P3):
   *     nama DAML template holding non-CC, cara query holding non-CC, endpoint
   *     transfer non-CC yang canonical.
   *   - Sementara: fallback off-chain credit aman dipakai (caller swapCCToToken
   *     tetap credit CantexTokenBalance walau delivery gagal). User bisa lihat
   *     saldo + swap token via off-chain. Hanya delivery on-chain yang pending.
   *
   * Status setelah return:
   *   - ok:true → token terkirim on-chain, user pegang asli
   *   - ok:false → delivery gagal (Cantex 400 untuk non-CC, receiver belum
   *     setup, dll). Fallback ke off-chain credit oleh caller — user tetap
   *     dapat saldo maya, tapi token asli di trading account.
   *
   * Non-blocking: error di-skip (log warn), supaya swap tetap sukses walau
   * delivery on-chain belum support per-token.
   */
  private async tryDeliverTokenOnChain(params: {
    swapTxId: string;
    userId: string;
    userPartyId: string;
    tokenId: string;
    tokenAdmin: string;
    amount: string;
    /** Request ID unik per swap (BUG P3.1) untuk korrelasi end-to-end di memo. */
    requestId: string;
  }): Promise<{ ok: boolean }> {
    // CC/Amulet tidak perlu Cantex transfer (pakai Canton ledger CIP-56).
    if (params.tokenId.toLowerCase() === 'amulet') {
      return { ok: false }; // CC handled by other path
    }
    // TODO: Non-CC on-chain delivery endpoint not yet available in Cantex client.
    // transferCC akan return 400 untuk non-CC (lihat LIMITATION di docstring
    // method ini). Coba panggil tetap dilakukan untuk forward-compat bila
    // Cantex suatu hari support non-CC di endpoint yang sama — tapi saat ini
    // ini akan selalu masuk catch block dan jatuh ke fallback off-chain.
    try {
      const result = await this.cantex.transferCC({
        receiver: params.userPartyId,
        amount: params.amount,
        instrumentId: params.tokenId,
        instrumentAdmin: params.tokenAdmin,
        // BUG P3.1: memo 4 segmen dengan Request ID unik per swap.
        memo: `canquest-swap|${params.userPartyId}|${params.tokenId}|${params.requestId}`,
      });
      this.logger.log(
        `On-chain delivery OK: ${params.amount} ${params.tokenId} → user party (swap ${params.swapTxId})`,
      );
      // Record PendingDelivery COMPLETED untuk audit trail.
      try {
        await this.prisma.pendingDelivery.create({
          data: {
            userId: params.userId,
            userPartyId: params.userPartyId,
            tokenId: params.tokenId,
            tokenAdmin: params.tokenAdmin,
            amount: new Decimal(params.amount),
            status: 'COMPLETED',
            transferKind: 'direct',
            deliveredAt: new Date(),
          },
        });
      } catch {
        /* audit-only, non-blocking */
      }
      return { ok: true };
    } catch (err) {
      // Expected untuk non-CC (Cantex 400). Bukan kesalahan kita — limitation
      // endpoint Cantex. Log warn (bukan error) supaya tidak banjiri monitoring
      // dengan error yang sudah diketahui root cause-nya.
      this.logger.warn(
        `On-chain delivery failed for ${params.tokenId} (swap ${params.swapTxId}), fallback to off-chain: ${(err as Error).message}`,
      );
      return { ok: false };
    }
  }

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
      maxNetworkFee?: string;
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
      maxNetworkFee?: string;
    },
  ) {
    const cfg = getCantexConfig();
    // BUG P3.1: Request ID unik per swap, untuk korrelasi end-to-end di memo
    // Cantex + log + DB. Diciptakan sekali per eksekusi, dipakai di memo delivery.
    const requestId = this.generateSwapRequestId();
    // Platform fee: fixed CC amount (bukan persen). Default 0.
    const platformFeeCc = Number(
      this.config.get<string>('SWAP_PLATFORM_FEE_CC') ?? '0',
    );

    // 1. Cek CC balance cukup (amount + platform fee).
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

    // 1a. Slippage + minimum safety gate (pre-execution).
    // Ambil fresh quote, tolak bila slippage > threshold atau amount < minimum.
    const gate = await this.checkSlippageGate({
      sellAmount: String(params.amount),
      sellInstrumentId: cfg.ccInstrumentId,
      sellInstrumentAdmin: cfg.ccInstrumentAdmin,
      buyInstrumentId: params.buyInstrumentId,
      buyInstrumentAdmin: params.buyInstrumentAdmin,
      minAmountCc: params.amount,
    });
    if (!gate.ok) {
      return {
        success: false,
        direction: 'CC_TO_TOKEN',
        message: gate.message,
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

      // 4. Cantex swap: sell CC → buy token (with retry backoff for balance errors).
      const swapResult = await this.swapWithRetry({
        sellAmount: String(params.amount),
        sellInstrumentId: cfg.ccInstrumentId,
        sellInstrumentAdmin: cfg.ccInstrumentAdmin,
        buyInstrumentId: params.buyInstrumentId,
        buyInstrumentAdmin: params.buyInstrumentAdmin,
        maxNetworkFee: params.maxNetworkFee,
      });

      // Defense-in-depth: verifikasi output instrument sesuai permintaan.
      if (
        swapResult.outputInstrumentId &&
        swapResult.outputInstrumentId.toLowerCase() !==
          params.buyInstrumentId.toLowerCase()
      ) {
        this.logger.error(
          `Swap output instrument mismatch! Expected ${params.buyInstrumentId}, got ${swapResult.outputInstrumentId} (swap ${swapTx.id})`,
        );
      }

      // 5. Deliver token: coba on-chain ke user party dulu (Wintip-style),
      //    fallback ke off-chain credit kalau gagal.
      //    On-chain: token ASLI dikirim ke user party via Cantex transferCC.
      //    Off-chain: token tetap di trading account, DB catat kepunyaan.
      const outputAmount = new Decimal(swapResult.outputAmount);
      const deliverOnChain = await this.tryDeliverTokenOnChain({
        swapTxId: swapTx.id,
        userId,
        userPartyId: user.cantonPartyId,
        tokenId: params.buyInstrumentId,
        tokenAdmin: params.buyInstrumentAdmin,
        amount: swapResult.outputAmount,
        requestId,
      });
      // Tetap credit off-chain untuk UI tracking (saldo user terlihat),
      // terlepas dari on-chain delivery berhasil atau tidak.
      try {
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
      } catch (dbErr) {
        this.logger.error(
          `CantexTokenBalance credit failed for swap ${swapTx.id}: ${(dbErr as Error).message}. Recording PendingDelivery.`,
        );
        try {
          await this.prisma.pendingDelivery.create({
            data: {
              userId,
              swapTransactionId: swapTx.id,
              userPartyId: user.cantonPartyId,
              tokenId: params.buyInstrumentId,
              tokenAdmin: params.buyInstrumentAdmin,
              amount: outputAmount,
              status: 'PENDING_APPROVAL',
              errorMessage: `Off-chain credit failed: ${(dbErr as Error).message}`,
            },
          });
        } catch (pdErr) {
          this.logger.error(
            `Failed to record PendingDelivery fallback for swap ${swapTx.id}: ${(pdErr as Error).message}`,
          );
        }
      }

      // 6. Record SWAP_OUT (CC debit).
      await this.users.recordTransaction({
        userId,
        amountCc: params.amount,
        type: 'SWAP_OUT',
        description: `Swap CC → ${params.buyInstrumentId}`,
        ledgerTxId: `swap:${swapTx.id}:cc-out`,
        status: 'COMPLETED',
      });

      // 7. Platform fee.
      // BUG-K.2 fix: blocking dari segi audit. Bila transfer fee gagal, swap
      // tetap sukses (token sudah diberikan ke user, tidak adil fail), TAPI
      // kegagalan dicatat ke PendingDelivery status FEE_PENDING supaya bisa
      // di-reconcile admin. Sebelumnya non-blocking warn-only → fee bocor
      // diam-diam tanpa jejak DB.
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
            await this.recordFeePending({
              swapTxId: swapTx.id,
              userId,
              userPartyId: user.cantonPartyId,
              feeAmountCc: platformFeeCc,
              feeRecipientPartyId: feeRecipient,
              clientNonceSuffix: ':fee',
              errorMessage: (err as Error).message,
            });
          }
        } else {
          // Recipient belum dikonfigurasi — fee tidak akan pernah dipotong.
          // Catat supaya admin sadar config hilang, bukan silent skip.
          this.logger.error(
            `SWAP_PLATFORM_FEE_CC=${platformFeeCc} tapi CANTON_FEE_RECIPIENT_PARTY_ID kosong. Fee tidak dipotong untuk swap ${swapTx.id}.`,
          );
          await this.recordFeePending({
            swapTxId: swapTx.id,
            userId,
            userPartyId: user.cantonPartyId,
            feeAmountCc: platformFeeCc,
            feeRecipientPartyId: '(not configured)',
            clientNonceSuffix: ':fee',
            errorMessage: 'CANTON_FEE_RECIPIENT_PARTY_ID not configured',
          });
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
      // BUG-D.4 fix: bila swap Cantex timeout SETELAH CC leg user sudah
      // terkirim ke trading account, CC user "stuck" di Cantex. Swap mungkin
      // (a) sukses terlambat di Cantex (client-side timeout ≠ Cantex gagal),
      // atau (b) benar-benar gagal dan butuh refund CC ke user.
      //
      // Jangan langsung throw & mark FAILED — itu menyembunyikan fakta bahwa
      // dana user sedang dalam keadaan ambiguous. Set status khusus
      // TIMEOUT_PENDING_DELIVERY (SwapTransaction.status free-text, tidak
      // butuh migrasi), catat PendingDelivery untuk cron/admin reconcile,
      // dan return message informatif ke user (bukan error mentah).
      if (err instanceof CantexTimeoutError) {
        this.logger.error(
          `Swap TIMEOUT after CC leg sent (swap ${swapTx.id}): CC ${params.amount} stuck in trading account. Needs reconcile/refund. Original: ${(err as Error).message}`,
          (err as Error).stack,
        );
        await this.prisma.swapTransaction.update({
          where: { id: swapTx.id },
          data: {
            status: 'TIMEOUT_PENDING_DELIVERY',
            errorMessage: `Swap timeout after CC leg sent: ${(err as Error).message}`,
          },
        });
        // Catat PendingDelivery supaya cron refund / admin bisa pick up.
        // Token = CC (yang stuck), amount = amount CC yang user kirim.
        try {
          await this.prisma.pendingDelivery.create({
            data: {
              userId,
              swapTransactionId: swapTx.id,
              userPartyId: user.cantonPartyId,
              tokenId: cfg.ccInstrumentId,
              tokenAdmin: cfg.ccInstrumentAdmin,
              amount: new Decimal(params.amount),
              amountMicroCc: BigInt(Math.round(params.amount * 1_000_000)),
              status: 'PENDING_APPROVAL',
              transferKind: 'unknown',
              errorMessage:
                `Swap timed out after CC leg sent. CC ${params.amount} may be stuck in trading account. ` +
                `Action needed: (a) check Cantex if swap eventually succeeded → deliver token to user; ` +
                `(b) if swap failed → refund CC to user party ${user.cantonPartyId}. ` +
                `Original timeout: ${(err as Error).message}`,
            },
          });
        } catch (pdErr) {
          this.logger.error(
            `CRITICAL: swap timeout AND PendingDelivery record failed for swap ${swapTx.id}. ` +
              `CC ${params.amount} may be lost without DB trace. PendingDelivery error: ${(pdErr as Error).message}`,
          );
        }
        // Jangan throw — return informative message supaya user dapat
        // feedback yang jelas, bukan error generik. User instructed to wait.
        return {
          success: false,
          direction: 'CC_TO_TOKEN',
          swapId: swapTx.id,
          message:
            'Swap timed out. Your CC is safe — if the swap does not complete, it will be refunded automatically. Please check your Activity in a few minutes.',
        };
      }

      // Error non-timeout (CantexError biasa, network, dll) → behavior lama:
      // mark FAILED + throw. Kalau ini terjadi SETELAH CC leg sukses (line 400),
      // CC juga stuck tapi error-nya non-timeout — tetap catat ke log error
      // supaya admin bisa reconcile manual.
      const afterCcLeg = err instanceof CantexError || err instanceof Error;
      this.logger.error(
        `Swap FAILED after CC leg (swap ${swapTx.id}, afterCcLeg=${afterCcLeg}): ${(err as Error).message}`,
        (err as Error).stack,
      );
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
      maxNetworkFee?: string;
    },
  ) {
    const cfg = getCantexConfig();
    // BUG P3.1: Request ID unik per swap, untuk korrelasi end-to-end di memo
    // Cantex (transfer CC balik ke user) + log + DB.
    const requestId = this.generateSwapRequestId();

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

    // 1a. Slippage + minimum safety gate (pre-execution).
    // Minimum ticket size untuk token→CC (default 2.5, via SAFE_MIN_SWAP_TOKEN).
    const gate = await this.checkSlippageGate({
      sellAmount: String(params.amount),
      sellInstrumentId: params.sellInstrumentId,
      sellInstrumentAdmin: params.sellInstrumentAdmin,
      buyInstrumentId: cfg.ccInstrumentId,
      buyInstrumentAdmin: cfg.ccInstrumentAdmin,
      minAmountToken: params.amount,
      minAmountTokenSymbol: params.sellInstrumentId,
    });
    if (!gate.ok) {
      return {
        success: false,
        direction: 'TOKEN_TO_CC',
        message: gate.message,
      };
    }

    // 1b. Pre-check: trading account on-chain holding cukup?
    // Cantex DEX swap terjadi di shared trading account. Kalau on-chain
    // holding kurang, swap akan ditolak "holding balance not enough".
    // WARN-ONLY: kita log drift tapi TIDAK memblokir swap — biarkan Cantex
    // yang membuat keputusan akhir. Memblokir di sini bisa false-positive
    // bila ada lag antara settle on-chain dan getAccountInfo.
    try {
      const acct = await this.cantex.getAccountInfo();
      const instr = acct.tokens.find(
        (t) =>
          t.instrument.id.toLowerCase() ===
            params.sellInstrumentId.toLowerCase() &&
          t.instrument.admin.toLowerCase() ===
            params.sellInstrumentAdmin.toLowerCase(),
      );
      const onChain = instr
        ? parseFloat(instr.unlockedAmount.toString())
        : 0;
      if (onChain < params.amount) {
        this.logger.warn(
          `DRIFT: TOKEN_TO_CC ${params.sellInstrumentId} — off-chain balance ${available}, on-chain trading account ${onChain}, required ${params.amount}. Swap akan tetap dicoba, Cantex akan validasi.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `TOKEN_TO_CC pre-check getAccountInfo failed (non-blocking): ${(err as Error).message}`,
      );
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
      // 3. Cantex swap: sell token → buy CC (with retry backoff for balance errors).
      const swapResult = await this.swapWithRetry({
        sellAmount: String(params.amount),
        sellInstrumentId: params.sellInstrumentId,
        sellInstrumentAdmin: params.sellInstrumentAdmin,
        buyInstrumentId: cfg.ccInstrumentId,
        buyInstrumentAdmin: cfg.ccInstrumentAdmin,
        maxNetworkFee: params.maxNetworkFee,
      });

      // Defense-in-depth: verifikasi output instrument sesuai permintaan.
      if (
        swapResult.outputInstrumentId &&
        swapResult.outputInstrumentId.toLowerCase() !==
          cfg.ccInstrumentId.toLowerCase()
      ) {
        this.logger.error(
          `Swap output instrument mismatch! Expected ${cfg.ccInstrumentId}, got ${swapResult.outputInstrumentId} (swap ${swapTx.id})`,
        );
      }

      const outputCc = new Decimal(swapResult.outputAmount);
      const outputCcNum = parseFloat(swapResult.outputAmount);

      // 4. Debit CantexTokenBalance off-chain (token yang dijual user).
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

      // 5. Transfer CC: trading account → user party (on-chain via Canton ledger).
      //    Non-blocking: kalau gagal, tetap credit off-chain (fund safety).
      let ccOnChain = false;
      try {
        await this.cantex.transferCC({
          receiver: user.cantonPartyId,
          amount: swapResult.outputAmount,
          instrumentId: cfg.ccInstrumentId,
          instrumentAdmin: cfg.ccInstrumentAdmin,
          // BUG P3.1: memo 4 segmen dengan Request ID unik per swap, konsisten
          // dengan format CC→Token delivery.
          memo: `canquest-swap|${user.cantonPartyId}|${cfg.ccInstrumentId}|${requestId}`,
        });
        ccOnChain = true;
        // Reconcile on-chain balance (CC sampai di user party).
        void this.inboundSync.alignBalanceFromChain(
          userId,
          user.username,
          user.cantonPartyId,
        );
      } catch (err) {
        this.logger.warn(
          `transferCC failed, falling back to off-chain credit: ${(err as Error).message}`,
        );
      }

      // 6. Credit CcBalance off-chain (jika on-chain gagal).
      //    Platform fee: fixed CC amount, di-deduct dari CC yang diterima user.
      const platformFeeCc = Number(
        this.config.get<string>('SWAP_PLATFORM_FEE_CC') ?? '0',
      );
      const netCc = outputCcNum - platformFeeCc;

      if (!ccOnChain) {
        // On-chain delivery gagal → credit off-chain (UX: user dapat CC),
        // TAPI record PendingDelivery untuk tracking + reconcile nanti.
        // Ini menggantikan silent off-chain credit yang menyebabkan drift.
        const netCcMicro = BigInt(Math.round(netCc * 1_000_000));
        await this.prisma.ccBalance.upsert({
          where: { userId },
          create: { userId, balanceMicroCc: netCcMicro },
          update: { balanceMicroCc: { increment: netCcMicro } },
        });
        try {
          await this.prisma.pendingDelivery.create({
            data: {
              userId,
              swapTransactionId: swapTx.id,
              userPartyId: user.cantonPartyId,
              tokenId: cfg.ccInstrumentId,
              tokenAdmin: cfg.ccInstrumentAdmin,
              amount: outputCc,
              amountMicroCc: netCcMicro,
              status: 'PENDING_APPROVAL',
              errorMessage: 'transferCC on-chain failed; CC credited off-chain pending reconcile',
            },
          });
          this.logger.warn(
            `PendingDelivery created for swap ${swapTx.id}: CC ${netCc} credited off-chain, on-chain delivery pending.`,
          );
        } catch (dbErr) {
          this.logger.error(
            `Failed to record PendingDelivery for swap ${swapTx.id}: ${(dbErr as Error).message}`,
          );
        }
      } else {
        // On-chain berhasil → CC sudah di user party.
        // alignBalanceFromChain akan update CcBalance dari on-chain truth.
        // Tapi tetap kirim platform fee on-chain.
        // BUG-K.2 fix: bila fee transfer gagal, catat ke PendingDelivery
        // status FEE_PENDING supaya bisa di-reconcile admin (bukan silent
        // skip). Swap tetap sukses dari sisi user.
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
              await this.recordFeePending({
                swapTxId: swapTx.id,
                userId,
                userPartyId: user.cantonPartyId,
                feeAmountCc: platformFeeCc,
                feeRecipientPartyId: feeRecipient,
                clientNonceSuffix: ':fee',
                errorMessage: (err as Error).message,
              });
            }
          } else {
            this.logger.error(
              `SWAP_PLATFORM_FEE_CC=${platformFeeCc} tapi CANTON_FEE_RECIPIENT_PARTY_ID kosong. Fee tidak dipotong untuk swap ${swapTx.id}.`,
            );
            await this.recordFeePending({
              swapTxId: swapTx.id,
              userId,
              userPartyId: user.cantonPartyId,
              feeAmountCc: platformFeeCc,
              feeRecipientPartyId: '(not configured)',
              clientNonceSuffix: ':fee',
              errorMessage: 'CANTON_FEE_RECIPIENT_PARTY_ID not configured',
            });
          }
        }
      }

      // 7. Record SWAP_IN (CC credit).
      await this.users.recordTransaction({
        userId,
        amountCc: netCc,
        type: 'SWAP_IN',
        description: `Swap ${params.sellInstrumentId} → CC`,
        ledgerTxId: `swap:${swapTx.id}:cc-in`,
        status: 'COMPLETED',
      });

      // 8. Update SwapTransaction EXECUTED.
      await this.prisma.swapTransaction.update({
        where: { id: swapTx.id },
        data: {
          status: 'EXECUTED',
          buyAmount: outputCc,
          swapExecutedAt: new Date(),
        },
      });

      // 8. Emit realtime.
      void this.realtime.push(userId, 'swap:completed', {
        direction: 'TOKEN_TO_CC',
        outputAmount: String(netCc),
      });

      return {
        success: true,
        direction: 'TOKEN_TO_CC',
        outputAmount: swapResult.outputAmount,
        swapId: swapTx.id,
      };
    } catch (err) {
      // BUG-D.4 fix: untuk TOKEN_TO_CC, swap Cantex dipanggil duluan SEBELUM
      // debit CantexTokenBalance. Jadi bila timeout di swap Cantex, token
      // user off-chain belum di-debit → tidak ada dana stuck user-side.
      // TAPI swap mungkin sukses terlambat di Cantex (client-side timeout ≠
      // Cantex gagal) → CC bisa masuk ke trading account tanpa kita catat.
      //
      // Set status khusus TIMEOUT_PENDING_DELIVERY supaya cron/admin bisa
      // check Cantex dan: (a) kalau swap sukses → credit CC ke user + debit
      // token off-chain; (b) kalau gagal → no-op (token user aman).
      if (err instanceof CantexTimeoutError) {
        this.logger.error(
          `Swap TIMEOUT during Cantex swap (swap ${swapTx.id}, TOKEN_TO_CC). Token off-chain NOT debited. Needs reconcile. Original: ${(err as Error).message}`,
          (err as Error).stack,
        );
        await this.prisma.swapTransaction.update({
          where: { id: swapTx.id },
          data: {
            status: 'TIMEOUT_PENDING_DELIVERY',
            errorMessage: `Swap timeout during Cantex swap (token not debited): ${(err as Error).message}`,
          },
        });
        // Catat PendingDelivery untuk tracking reconcile (CC yang mungkin
        // perlu di-credit ke user kalau swap ternyata sukses).
        try {
          await this.prisma.pendingDelivery.create({
            data: {
              userId,
              swapTransactionId: swapTx.id,
              userPartyId: user.cantonPartyId,
              tokenId: cfg.ccInstrumentId,
              tokenAdmin: cfg.ccInstrumentAdmin,
              // Estimasi CC output tidak diketahui (swap belum konfirmasi) →
              // pakai sellAmount sebagai placeholder. Cron reconcile akan
              // update nilai asli setelah cek Cantex.
              amount: new Decimal(params.amount),
              status: 'PENDING_APPROVAL',
              transferKind: 'unknown',
              errorMessage:
                `TOKEN_TO_CC swap timed out during Cantex swap. Off-chain token (${params.amount} ${params.sellInstrumentId}) NOT debited. ` +
                `Action needed: (a) check Cantex if swap succeeded → credit CC to user + debit token off-chain; ` +
                `(b) if swap failed → no-op (token safe). Original timeout: ${(err as Error).message}`,
            },
          });
        } catch (pdErr) {
          this.logger.error(
            `CRITICAL: swap timeout AND PendingDelivery record failed for swap ${swapTx.id} (TOKEN_TO_CC). PendingDelivery error: ${(pdErr as Error).message}`,
          );
        }
        return {
          success: false,
          direction: 'TOKEN_TO_CC',
          swapId: swapTx.id,
          message:
            'Swap timed out. Your tokens are safe — the swap is being verified. Please check your Activity in a few minutes.',
        };
      }

      this.logger.error(
        `Swap FAILED (swap ${swapTx.id}, TOKEN_TO_CC): ${(err as Error).message}`,
        (err as Error).stack,
      );
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
