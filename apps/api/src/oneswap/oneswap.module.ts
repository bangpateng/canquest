/**
 * OneSwapModule — DEX integration via OneSwap (custodial swap CC↔token).
 *
 * @Global supaya CantonPriceService (di CantonModule) bisa inject OneSwapClient
 * tanpa import eksplisit (sama seperti CantexModule lama). OneSwapClient:
 * wrapper tipis @oneswap/sdk. SwapService: orchestration custodial swap
 * (transfer input → depositParty → tunggu output balik ke user).
 *
 * Menggantikan CantexModule. Pricing instrument list (untuk CantonPriceService)
 * sekarang dari OneSwap listTokens(), bukan Cantex getAllSwapInstruments().
 */

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CantonModule } from '../canton/canton.module';
import { UsersModule } from '../users/users.module';
import { OneSwapClient } from './oneswap-client';
import { SwapService } from './swap.service';

@Global()
@Module({
  // ConfigModule sudah global, tapi import eksplisit untuk kejelasan dependency.
  imports: [ConfigModule, CantonModule, UsersModule],
  providers: [OneSwapClient, SwapService],
  exports: [OneSwapClient, SwapService],
})
export class OneSwapModule {}
