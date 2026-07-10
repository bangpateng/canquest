import { Global, Module } from '@nestjs/common';
import { CantexClient } from './cantex-client';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient constructor TIDAK pernah throw (lazy validation) → API selalu
 * start walau config Cantex belum lengkap. Signer di-init lazy saat pertama
 * kali method dipanggil (ensureReady). Endpoint swap cek `isCantexEnabled()`
 * lebih dulu, lalu CantexClient.throw CantexError bila config belum lengkap.
 */
@Global()
@Module({
  providers: [CantexClient],
  exports: [CantexClient],
})
export class CantexModule {}
