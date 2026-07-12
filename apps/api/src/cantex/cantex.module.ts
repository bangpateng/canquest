import { Global, Module } from '@nestjs/common';
import { CantonModule } from '../canton/canton.module';
import { UsersModule } from '../users/users.module';
import { CantexClient } from './cantex-client';
import { CantexPriceFeedService } from './cantex-price-feed.service';
import { SwapService } from './swap.service';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient: REST + WS client (auth, pools, quote, swap, transfer).
 * CantexPriceFeedService: real-time price feed via public WebSocket.
 * SwapService: orchestration untuk CC ↔ token swap (custodial).
 *
 * Import CantonModule + UsersModule supaya SwapService dapat inject:
 *   - CantonLedgerService, CcInboundSyncService (from CantonModule)
 *   - UsersService, WalletPasswordService (from UsersModule)
 */
@Global()
@Module({
  imports: [CantonModule, UsersModule],
  providers: [CantexClient, CantexPriceFeedService, SwapService],
  exports: [CantexClient, CantexPriceFeedService, SwapService],
})
export class CantexModule {}
