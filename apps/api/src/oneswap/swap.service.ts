/**
 * SwapService — orchestration untuk token swap via OneSwap (custodial).
 *
 * OneSwap model "deposit-then-return" (atomic DvP):
 *   1. Backend createSwap → dapat depositParty + deadline (60 menit)
 *   2. Backend transfer input user → depositParty (Canton ledger)
 *      → backend jadi "funding party" → senderParty = party user
 *   3. OneSwap deteksi deposit → eksekusi swap atomik di pool
 *   4. Output balik ke senderParty (= party user). Tanpa langkah delivery.
 *
 * User tidak co-sign DvP transaction, tidak butuh gas (networkFeeIn dari input).
 * Atomic guarantee: output balik ATAU input refund — dana tidak pernah tersangkut.
 *
 * Fee: OneSwap native (platformFee + lpFee + networkFeeIn, semua dari quote).
 * TIDAK ada platform fee dapp Canquest di swap (sesuai keputusan — fee dapp
 * hanya di jalur Send, via TRANSACTION_FEE_CC → CANTON_FEE_RECIPIENT_PARTY_ID).
 *
 * Menggantikan Cantex swap.service.ts lama (intent flow + delivery manual +
 * platform fee collection). Jauh lebih ringkas karena return-to-sender
 * menghilangkan langkah delivery & refund manual.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { UsersService } from '../users/users.service';
import { RealtimeService } from '../realtime/realtime.service';
import { hasRealWallet } from '../common/wallet-policy';
import { OneSwapClient } from './oneswap-client';
import { getOneSwapConfig } from './oneswap.config';
import type { ExecuteSwapParams, SwapExecResult } from './oneswap.types';
import { OpenSwapExistsError } from '@oneswap/sdk';
import type { Token } from '@oneswap/sdk';

/** CC instrument id (Amulet) — symbol 'CC' memetakan ke instrument id 'Amulet'. */
const CC_SYMBOL = 'CC';
const CC_INSTRUMENT_ID = 'Amulet';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  /** Mencegah eksekusi paralel untuk user yang sama (race double-click). */
  private readonly swapInFlight = new Set<string>();

  /** Cache token map: symbol → {id, admin}. TTL pendek (refresh tiap menit). */
  private tokenCache: { at: number; map: Map<string, Token> } | null = null;
  private static readonly TOKEN_CACHE_TTL_MS = 60_000;

  constructor(
    private readonly oneswap: OneSwapClient,
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly users: UsersService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Execute swap `from` → `to` untuk user. Custodial: backend orchestrate
   * transfer input + tunggu OneSwap selesai + record transaksi + emit SSE.
   */
  async executeSwap(
    userId: string,
    params: ExecuteSwapParams,
  ): Promise<SwapExecResult> {
    // Guard: 1 swap in-flight per user (anti double-click race).
    if (this.swapInFlight.has(userId)) {
      return {
        success: false,
        direction: '',
        message: 'A swap is already in progress. Please wait.',
      };
    }
    this.swapInFlight.add(userId);
    try {
      const user = await this.users.findById(userId);
      if (!user?.cantonPartyId || !user?.username) {
        return { success: false, direction: '', message: 'Wallet not found.' };
      }
      // Narrow username ke string (di-guard di atas — null/undefined sudah return).
      const userInfo = {
        id: user.id,
        username: user.username,
        cantonPartyId: user.cantonPartyId,
      };
      if (!hasRealWallet(user.cantonPartyId)) {
        return {
          success: false,
          direction: '',
          message: 'You need a Canton wallet to use swap.',
        };
      }

      // Idempotency: clientNonce sudah dipakai? Return hasil sebelumnya.
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

      const direction =
        params.from.toUpperCase() === CC_SYMBOL ? 'CC_TO_TOKEN' : 'TOKEN_TO_CC';

      // Buat record SwapTransaction PENDING (mirror pattern Cantex lama).
      const swapTx = await this.prisma.swapTransaction.create({
        data: {
          userId,
          direction,
          sellInstrumentId: params.from,
          sellInstrumentAdmin: '', // OneSwap identifikasi via symbol, admin di-resolve saat transfer
          sellAmount: params.amount,
          buyInstrumentId: params.to,
          buyInstrumentAdmin: '',
          clientNonce: params.clientNonce,
          status: 'PENDING',
        },
      });

      try {
        const result = await this.runOneSwap(userId, userInfo, params);
        // Update record sesuai hasil.
        await this.prisma.swapTransaction.update({
          where: { id: swapTx.id },
          data: {
            status: result.success ? 'EXECUTED' : 'FAILED',
            buyAmount: result.outputAmount ? Number(result.outputAmount) : null,
            swapExecutedAt: result.success ? new Date() : null,
            errorMessage: result.success ? null : (result.message ?? null),
          },
        });
        return { ...result, swapId: swapTx.id };
      } catch (err) {
        // Gagal di tengah — catat + jangan biarkan record PENDING selamanya.
        const msg = (err as Error).message;
        this.logger.error(
          `OneSwap failed (swap ${swapTx.id}): ${msg}`,
          (err as Error).stack,
        );
        await this.prisma.swapTransaction.update({
          where: { id: swapTx.id },
          data: { status: 'FAILED', errorMessage: msg },
        });
        return {
          success: false,
          direction: '',
          message: msg,
          swapId: swapTx.id,
        };
      }
    } finally {
      this.swapInFlight.delete(userId);
    }
  }

  /**
   * Inti alur OneSwap: quote gate → create-or-resume → transfer input → wait.
   * Throw bila gagal (di-catch caller untuk update record).
   */
  private async runOneSwap(
    userId: string,
    user: { id: string; username: string; cantonPartyId: string },
    params: ExecuteSwapParams,
  ): Promise<SwapExecResult> {
    const cfg = getOneSwapConfig();

    // ── 1. Quote gate: validasi pair ada + price impact acceptable ───────
    const quote = await this.oneswap.getQuote({
      from: params.from,
      to: params.to,
      amount: params.amount,
    });
    if (quote.priceImpactPct > cfg.maxPriceImpactPct) {
      throw new Error(
        `Price impact too high (${quote.priceImpactPct.toFixed(2)}% > ${cfg.maxPriceImpactPct}%). Try a smaller amount.`,
      );
    }

    // ── 2. Create-or-resume (anti OpenSwapExistsError) ───────────────────
    // 1 userRef = 1 open swap. Kalau ada yang masih terbuka, resolve dulu.
    let swap = await this.createOrResumeSwap({
      userRef: user.id,
      inSymbol: params.from,
      amountIn: params.amount,
      outSymbol: params.to,
      minOut: Math.max(0, quote.amountOut * 0.98), // floor 2% di bawah quote
      slippageBps: cfg.defaultSlippageBps,
    });

    // Kalau swap lama sudah terminal (refunded/expired), recreate yang baru.
    if (
      ['returned', 'refunded', 'expired', 'failed', 'cancelled'].includes(
        swap.status,
      )
    ) {
      swap = await this.createOrResumeSwap({
        userRef: user.id,
        inSymbol: params.from,
        amountIn: params.amount,
        outSymbol: params.to,
        minOut: Math.max(0, quote.amountOut * 0.98),
        slippageBps: cfg.defaultSlippageBps,
      });
    }

    // ── 3. Transfer input user → depositParty (backend jadi funder) ───────
    // Output OneSwap balik ke senderParty = party yang transfer = party user.
    // Cuma transfer kalau swap masih butuh deposit (awaiting_deposit).
    if (swap.status === 'awaiting_deposit') {
      const inputToken = await this.resolveToken(params.from);
      const transfer = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId: user.cantonPartyId,
        receiverPartyId: swap.depositParty,
        amountCc: params.amount,
        description: `Swap ${params.amount} ${params.from} → ${params.to} (OneSwap ${swap.id})`,
        instrumentId: inputToken.id,
        instrumentAdmin: inputToken.admin,
      });
      if (!transfer.ok) {
        // Transfer gagal — cancel swap agar userRef bebas. Dana user tidak bergerak.
        try {
          await this.oneswap.cancel(swap.id);
        } catch {
          /* swap mungkin sudah nerima partial — biarkan timeout */
        }
        throw new Error(
          `Failed to send ${params.amount} ${params.from} to swap: ${transfer.error ?? 'transfer rejected'}`,
        );
      }
    }

    // ── 4. Wait for terminal status ──────────────────────────────────────
    const done = await this.oneswap.waitForSwap(swap.id, {
      timeoutMs: 15 * 60_000, // 15 menit (deadline OneSwap 60m, kita shorter)
    });

    const direction =
      params.from.toUpperCase() === CC_SYMBOL ? 'CC_TO_TOKEN' : 'TOKEN_TO_CC';

    switch (done.status) {
      case 'returned': {
        // Sukses. Output sudah balik ke party user (senderParty). Catat transaksi.
        await this.users.recordTransaction({
          userId,
          amountCc: params.amount,
          type: 'SWAP_OUT',
          description: `Swap ${params.amount} ${params.from} → ${done.amountOut} ${params.to} (OneSwap fee incl.)`,
          ledgerTxId: `oneswap:${done.id}:in`,
          status: 'COMPLETED',
          silent: true, // notif via SSE swap:completed (anti duplikat)
        });
        await this.users.recordTransaction({
          userId,
          amountCc: done.amountOut ?? 0,
          type: 'SWAP_IN',
          description: `Swap received ${done.amountOut} ${params.to}`,
          ledgerTxId: `oneswap:${done.id}:out`,
          status: 'COMPLETED',
          silent: true,
        });

        // Reconcile saldo CC (kalau salah satu leg CC).
        void this.inboundSync.alignBalanceFromChain(userId, user.username);

        // Emit SSE (nama sama dengan Cantex lama — FE use-realtime tetap jalan).
        void this.realtime.push(userId, 'swap:completed', {
          direction,
          outputAmount: String(done.amountOut ?? 0),
        });

        return {
          success: true,
          direction,
          outputAmount: String(done.amountOut ?? 0),
        };
      }
      case 'refunded':
        // Input balik ke user. Tidak ada pergerakan neto — jangan catat swap leg.
        this.logger.warn(
          `OneSwap ${done.id} refunded — input returned to user ${userId}`,
        );
        return {
          success: false,
          direction: '',
          message:
            'Swap refunded — the amount was outside tolerance or below minimum output. Input returned to you.',
        };
      case 'expired':
        return {
          success: false,
          direction: '',
          message: 'Swap expired before the deposit arrived. Please try again.',
        };
      case 'cancelled':
        return {
          success: false,
          direction: '',
          message: 'Swap was cancelled. Please try again.',
        };
      case 'failed':
      case 'needs_review':
        this.logger.error(
          `OneSwap ${done.id} terminal=${done.status} error=${done.error ?? 'n/a'}`,
        );
        return {
          success: false,
          direction: '',
          message: `Swap could not complete (${done.status}). Your input is safe — contact support if needed.`,
        };
      default:
        // Non-terminal setelah timeout (awaiting_deposit/deposit_detected/swapping/recovering).
        this.logger.warn(
          `OneSwap ${done.id} timed out at status=${done.status} — still processing`,
        );
        return {
          success: false,
          direction: '',
          message:
            'Swap is still processing. Your balance will update once it completes.',
        };
    }
  }

  /**
   * Create-or-resume pattern (anti OpenSwapExistsError).
   * 1 userRef hanya boleh 1 open swap. Kalau ada yang terbuka:
   *   - awaiting_deposit → cancel lalu recreate (dana belum masuk, aman)
   *   - sudah deposit → resume (biarkan waitForSwap yang tunggu)
   */
  private async createOrResumeSwap(args: {
    userRef: string;
    inSymbol: string;
    amountIn: number;
    outSymbol: string;
    minOut: number;
    slippageBps: number;
  }) {
    try {
      return await this.oneswap.createSwap(args);
    } catch (err) {
      if (!(err instanceof OpenSwapExistsError)) throw err;

      const open = await this.oneswap.getOpenSwap(args.userRef);
      if (!open) {
        // Race: open swap hilang di antara — retry create.
        return this.oneswap.createSwap(args);
      }
      // awaiting_deposit (belum nerima deposit) → cancel + recreate.
      if (open.status === 'awaiting_deposit') {
        try {
          await this.oneswap.cancel(open.id);
        } catch {
          /* mungkin sudah deposit — biarkan */
        }
        return this.oneswap.createSwap(args);
      }
      // Sudah deposit / processing → resume (return swap existing).
      return open;
    }
  }

  /**
   * Resolve OneSwap Token (id + admin) dari symbol, via cache listTokens().
   * Dipakai untuk instrumentId+admin saat executeTransferFactoryTransfer.
   */
  private async resolveToken(symbol: string): Promise<Token> {
    const map = await this.getTokenMap();
    const tok = map.get(symbol.toUpperCase());
    if (!tok) {
      throw new Error(`Token symbol "${symbol}" not found in OneSwap tokens.`);
    }
    return tok;
  }

  private async getTokenMap(): Promise<Map<string, Token>> {
    if (
      this.tokenCache &&
      Date.now() - this.tokenCache.at < SwapService.TOKEN_CACHE_TTL_MS
    ) {
      return this.tokenCache.map;
    }
    const tokens = await this.oneswap.listTokens();
    const map = new Map<string, Token>();
    for (const t of tokens) {
      // 'CC' symbol → tambah juga mapping ke instrument id 'Amulet' untuk ledger.
      map.set(t.symbol.toUpperCase(), t);
      if (t.id.toUpperCase() === CC_INSTRUMENT_ID.toUpperCase()) {
        map.set(CC_SYMBOL, t);
      }
    }
    this.tokenCache = { at: Date.now(), map };
    return map;
  }
}
