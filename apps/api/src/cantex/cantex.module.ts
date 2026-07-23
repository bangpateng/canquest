import { Global, Module } from '@nestjs/common';
import { CantonModule } from '../canton/canton.module';
import { UsersModule } from '../users/users.module';
import { CantexClient } from './cantex-client';
import { SwapService } from './swap.service';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient: REST client (auth, pools, quote, swap, transfer).
 * SwapService: orchestration untuk CC ↔ token swap (custodial).
 *
 * Pricing (CC/USDCx) TIDAK lagi di sini — pindah ke CantonPriceService
 * (scan-proxy Canton). Cantex hanya dipakai untuk swap + query pools.
 *
 * Import CantonModule + UsersModule supaya SwapService dapat inject:
 *   - CantonLedgerService, CcInboundSyncService (from CantonModule)
 *   - UsersService (from UsersModule)
 */
@Global()
@Module({
  imports: [CantonModule, UsersModule],
  providers: [CantexClient, SwapService],
  exports: [CantexClient, SwapService],
})
export class CantexModule {}
