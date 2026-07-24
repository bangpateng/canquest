/**
 * OneSwapClient — wrapper tipis atas @oneswap/sdk.
 *
 * Tanggung jawab: inisialisasi SDK client dari env (lazy validation), dan
 * expose method yang dibutuhkan swap.service + controller. Tidak menambah
 * logika bisnis — itu ada di SwapService. Menggantikan CantexClient lama.
 *
 * Mengikuti pattern CantexClient lama: config di-read lazy (bukan di
 * constructor) supaya app boot walau API key belum diset. ensureReady()
 * throw saat method dipanggil tanpa key.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OneSwap } from '@oneswap/sdk';
import { validateOneSwapConfig } from './oneswap.config';

@Injectable()
export class OneSwapClient {
  private readonly logger = new Logger(OneSwapClient.name);

  /** Instance SDK — dibuat lazy saat pertama dipakai. */
  private sdk: OneSwap | null = null;

  /** Validasi config + buat instance SDK (idempotent). Throw bila no API key. */
  private ensureReady(): OneSwap {
    if (this.sdk) return this.sdk;
    const cfg = validateOneSwapConfig();
    this.sdk = new OneSwap({
      apiKey: cfg.apiKey,
      environment: cfg.environment,
      timeout: cfg.timeoutMs,
    });
    this.logger.log(
      `OneSwap SDK ready (env=${cfg.environment}, base=${this.sdk.baseUrl})`,
    );
    return this.sdk;
  }

  // ── Tokens & Pools (read-only, dipakai CantonPriceService + controller) ──

  /** Daftar token yang bisa di-settle OneSwap: {symbol, admin, id, registryUrl?}. */
  async listTokens() {
    return this.ensureReady().tokens.list();
  }

  /** Semua pool visible: reserves, fee config, swapsEnabled flag. */
  async listPools() {
    return this.ensureReady().pools.list();
  }

  /** Satu pool + history swap-nya. */
  async getPool(poolId: string) {
    return this.ensureReady().pools.get(poolId);
  }

  /** Live market data pool: USD price, 24h change, 24h volume. */
  async getTicker(poolId: string) {
    return this.ensureReady().pools.getTicker(poolId);
  }

  // ── Quotes ───────────────────────────────────────────────────────────────

  /** Quote swap `amount` `from` → `to`. Throw NoDirectPoolError / AmbiguousPoolPairError. */
  async getQuote(args: { from: string; to: string; amount: number }) {
    return this.ensureReady().quotes.get(args);
  }

  // ── Swaps (create-or-resume, fund, wait) ─────────────────────────────────

  /** Buat swap. Response.depositParty = Canton party tujuan transfer input. */
  async createSwap(args: {
    userRef: string;
    inSymbol: string;
    amountIn: number;
    outSymbol: string;
    minOut?: number;
    slippageBps?: number;
  }) {
    return this.ensureReady().swaps.createSwap(args);
  }

  /** State swap by id (poll manual). */
  async getSwap(id: string) {
    return this.ensureReady().swaps.getSwap(id);
  }

  /**
   * Satu swap terbuka (non-terminal) untuk userRef, atau null. Dipakai untuk
   * recovery saat createSwap throw OpenSwapExistsError (1 userRef = 1 open swap).
   */
  async getOpenSwap(userRef: string) {
    return this.ensureReady().swaps.getOpenSwap(userRef);
  }

  /** Cancel swap yang masih awaiting_deposit (belum nerima deposit). */
  async cancel(id: string) {
    return this.ensureReady().swaps.cancel(id);
  }

  /**
   * Poll getSwap tiap pollMs sampai terminal (returned/refunded/expired/failed)
   * atau timeoutMs (default 15 menit). Tidak reject saat timeout — inspect status.
   */
  async waitForSwap(
    id: string,
    opts?: { pollMs?: number; timeoutMs?: number },
  ) {
    return this.ensureReady().swaps.waitForSwap(id, opts);
  }
}
