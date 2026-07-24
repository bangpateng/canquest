/**
 * Canton price service — harga token wallet dari API publik Canton.
 *
 * Sumber (sesuai kebijakan Canton & dokumentasi resmi):
 *   - CC (Amulet): scan-proxy open-and-issuing-mining-rounds → payload.amuletPrice
 *   - USDCx: hardcode 1 USD (stablecoin 1:1 anchor, tidak butuh API)
 *   - CBTC: tidak ada harga (Coming soon — frontend tidak menampilkan fiat)
 *
 * OneSwap DEX TIDAK dipakai untuk pricing — hanya untuk swap.
 * Admin token (untuk key matching) diambil dari OneSwap listTokens()
 * supaya konsisten dengan /party/pools (key format = "<id>::<admin>").
 *
 * Cache in-memory 30 detik. Fail-tolerant: bila scan-proxy gagal → return
 * cache lama (stale better than no data), bila tidak ada cache → return {}
 * (frontend handle price=0).
 */

import { Injectable, Logger } from '@nestjs/common';
import { CantonLedgerService } from './canton-ledger.service';
import { OneSwapClient } from '../oneswap/oneswap-client';
import { isVisibleInstrument } from '../party/visible-instruments';

/** Map token price: key = "<id>::<admin>", value = USD price (number). */
export type TokenPriceMap = Record<string, number>;

@Injectable()
export class CantonPriceService {
  private readonly logger = new Logger(CantonPriceService.name);

  /** Cache 30 detik — hindari hit scan-proxy + OneSwap tokens setiap poll. */
  private cache: { at: number; data: TokenPriceMap } | null = null;
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly oneswap: OneSwapClient,
  ) {}

  /**
   * Harga USD semua token whitelist (CC + USDCx) dari sumber Canton.
   * Key format: "<instrumentId>::<instrumentAdmin>" (match dengan /party/pools).
   *
   * USDCx selalu 1 (hardcode). CC dari scan-proxy amuletPrice.
   * CBTC tidak dimasukkan (no price — Coming soon).
   */
  async getTokenPrices(): Promise<TokenPriceMap> {
    // Cache check.
    if (this.cache && Date.now() - this.cache.at < CantonPriceService.TTL_MS) {
      return this.cache.data;
    }

    try {
      // Ambil daftar instrument (id + admin) dari OneSwap tokens — supaya admin
      // token sama persis dengan /party/pools (key matching di frontend).
      const instruments = await this.oneswap.listTokens();
      const prices: TokenPriceMap = {};

      // Harga CC dari scan-proxy (sumber resmi Canton).
      const amuletPrice = await this.ledger.getAmuletPrice();

      for (const inst of instruments) {
        if (!isVisibleInstrument(inst.id)) continue;
        const key = `${inst.id}::${inst.admin}`;
        const idUpper = inst.id.toUpperCase();

        if (idUpper === 'AMULET') {
          // CC — harga dinamis dari scan-proxy.
          if (amuletPrice != null && Number.isFinite(amuletPrice)) {
            prices[key] = amuletPrice;
          }
          // Bila amuletPrice null (scan-proxy gagal) → skip, fallback cache lama.
        } else if (idUpper === 'USDCX') {
          // USDCx = $1 anchor (stablecoin 1:1, tidak butuh API).
          prices[key] = 1;
        }
        // CBTC: tidak dimasukkan (no price — Coming soon).
      }

      // Bila CC gagal ambil harga tapi cache lama ada → pertahankan harga CC lama
      // (stale better than no data, sesuai pattern TanStack Query).
      if (amuletPrice == null && this.cache?.data) {
        for (const [k, v] of Object.entries(this.cache.data)) {
          if (k.split('::')[0].toUpperCase() === 'AMULET' && !(k in prices)) {
            prices[k] = v;
          }
        }
      }

      this.cache = { at: Date.now(), data: prices };
      return prices;
    } catch (err) {
      this.logger.warn(
        `getTokenPrices failed: ${(err as Error).message} — return stale cache`,
      );
      // Return cache lama bila ada, kalau tidak kosong map.
      return this.cache?.data ?? {};
    }
  }
}
