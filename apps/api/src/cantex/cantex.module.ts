import { Global, Module } from '@nestjs/common';
import { CantexClient } from './cantex-client';
import { CantexPriceFeedService } from './cantex-price-feed.service';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient: REST client (auth, pools, quote, swap Phase 2).
 * CantexPriceFeedService: real-time price feed via public WebSocket
 *   (subscribes market.<TOKEN>-USDCx.ticker, maintains live price map).
 *
 * Keduanya constructor-safe (lazy validation) → API selalu start walau
 * config Cantex belum lengkap.
 */
@Global()
@Module({
  providers: [CantexClient, CantexPriceFeedService],
  exports: [CantexClient, CantexPriceFeedService],
})
export class CantexModule {}
