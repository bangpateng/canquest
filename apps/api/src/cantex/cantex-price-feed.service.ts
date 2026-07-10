/**
 * Cantex price feed service — real-time token prices via public WebSocket.
 *
 * On OnModuleInit: connect WS public, subscribe ticker channels untuk semua
 * pool (market.<TOKEN>-USDCx.ticker), maintain live price map in memory.
 *
 * getTokenPrices() return live map (real-time, no polling).
 * Fallback: REST quote (getQuote) bila WS belum siap.
 *
 * USDCx = $1 anchor. Price map key = "<instrumentId>::<instrumentAdmin>".
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { CantexClient, type TokenPriceMap } from './cantex-client';
import { CantexWebSocketClient, parseTickerEvent } from './cantex-ws';
import { getCantexConfig } from './cantex.config';
import type { InstrumentId } from './cantex.types';

@Injectable()
export class CantexPriceFeedService implements OnModuleInit {
  private readonly logger = new Logger(CantexPriceFeedService.name);
  private ws: CantexWebSocketClient | null = null;
  private livePrices: TokenPriceMap = {};
  private wsReady = false;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly client: CantexClient) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Cantex disabled — price feed tidak start.');
      return;
    }
    // Non-blocking init (jangan block API startup).
    this.initPromise = this.init().catch((err) => {
      this.logger.error(`Price feed init failed: ${err.message}`);
    });
  }

  private isEnabled(): boolean {
    return process.env.CANTEX_ENABLED === 'true';
  }

  /**
   * Connect WS + subscribe ticker channels.
   * Discover pools dulu untuk tau channel mana yang perlu di-subscribe.
   */
  private async init(): Promise<void> {
    const cfg = getCantexConfig();
    // 1. Discover pools + USDCx.
    const pools = await this.client.getPools();
    const usdcx = this.findUsdcx(pools);
    if (!usdcx) {
      this.logger.warn(
        'USDCx tidak ditemukan di pools — price feed pakai REST fallback only.',
      );
      return;
    }
    // USDCx itu sendiri = $1.
    this.livePrices[`${usdcx.id}::${usdcx.admin}`] = 1;

    // 2. Build ticker channels: market.<TOKEN>-USDCx.ticker untuk tiap token.
    const allTokens = this.allPoolInstruments(pools);
    const nonUsdcxTokens = allTokens.filter(
      (t) =>
        !(
          t.id === usdcx.id &&
          t.admin.toLowerCase() === usdcx.admin.toLowerCase()
        ),
    );
    // Channel format: market.<TOKEN>-<USDCx>.ticker
    // Python SDK example: "market.BTC-USDC.ticker" (line 1629).
    const channels = nonUsdcxTokens.map(
      (t) => `market.${t.id}-${usdcx.id}.ticker`,
    );

    // 3. Seed prices via REST (supaya ada harga sebelum WS snapshot masuk).
    await this.seedPricesViaRest(nonUsdcxTokens, usdcx);

    // 4. Connect WS + subscribe.
    this.ws = new CantexWebSocketClient(cfg.apiBaseUrl, '/v1/ws/public');
    this.ws.connect((frame) => {
      const ticker = parseTickerEvent(frame);
      if (ticker && ticker.price.greaterThan(0)) {
        // Parse market "CC-USDCx" → CC token.
        const tokenSymbol = ticker.market.split('-')[0];
        if (tokenSymbol) {
          // Cari instrument asli (case-sensitive) dari pool untuk dapat admin.
          const inst = nonUsdcxTokens.find(
            (t) => t.id.toUpperCase() === tokenSymbol.toUpperCase(),
          );
          if (inst) {
            const key = `${inst.id}::${inst.admin}`;
            this.livePrices[key] = parseFloat(ticker.price.toString());
          }
        }
      }
    });
    // Subscribe setelah connect (WS wrapper re-subscribe on reconnect).
    setTimeout(() => {
      this.ws?.subscribe(channels);
      this.wsReady = true;
      this.logger.log(
        `Price feed live: subscribed ${channels.length} ticker channels.`,
      );
    }, 2000); // tunggu WS open.
  }

  /**
   * Return live prices. Bila WS belum siap, fallback ke REST quote.
   */
  async getTokenPrices(): Promise<TokenPriceMap> {
    if (!this.isEnabled()) return {};
    // Tunggu init selesai (bila lagi berjalan).
    if (this.initPromise) await this.initPromise;
    if (this.wsReady && Object.keys(this.livePrices).length > 0) {
      return { ...this.livePrices };
    }
    // Fallback: REST (client punya cache 30s sendiri).
    return this.client.getTokenPrices();
  }

  /** Seed initial prices via REST quote (before WS snapshot arrives). */
  private async seedPricesViaRest(
    tokens: InstrumentId[],
    usdcx: InstrumentId,
  ): Promise<void> {
    await Promise.all(
      tokens.map(async (inst) => {
        try {
          const quote = await this.client.getQuote({
            sellAmount: '1',
            sellInstrumentId: inst.id,
            sellInstrumentAdmin: inst.admin,
            buyInstrumentId: usdcx.id,
            buyInstrumentAdmin: usdcx.admin,
          });
          this.livePrices[`${inst.id}::${inst.admin}`] = parseFloat(
            quote.returned.amount.toString(),
          );
        } catch (err) {
          this.logger.debug(
            `Seed price failed for ${inst.id}: ${(err as Error).message}`,
          );
        }
      }),
    );
    this.logger.debug(
      `Seeded ${Object.keys(this.livePrices).length} token prices via REST.`,
    );
  }

  private findUsdcx(
    pools: { tokenA: InstrumentId; tokenB: InstrumentId }[],
  ): InstrumentId | null {
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        if (leg.id.toUpperCase() === 'USDCX') return leg;
      }
    }
    return null;
  }

  private allPoolInstruments(
    pools: { tokenA: InstrumentId; tokenB: InstrumentId }[],
  ): InstrumentId[] {
    const seen = new Map<string, InstrumentId>();
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        const key = `${leg.id}::${leg.admin}`;
        if (!seen.has(key)) seen.set(key, leg);
      }
    }
    return [...seen.values()];
  }
}
