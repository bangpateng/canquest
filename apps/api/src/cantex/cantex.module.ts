import { Global, Module } from '@nestjs/common';
import { CantexClient } from './cantex-client';
import { CantexPriceFeedService } from './cantex-price-feed.service';
import { SwapService } from './swap.service';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient: REST + WS client (auth, pools, quote, swap, transfer).
 * CantexPriceFeedService: real-time price feed via public WebSocket.
 * SwapService: orchestration untuk CC ↔ token swap (custodial).
 */
@Global()
@Module({
  providers: [CantexClient, CantexPriceFeedService, SwapService],
  exports: [CantexClient, CantexPriceFeedService, SwapService],
})
export class CantexModule {}
