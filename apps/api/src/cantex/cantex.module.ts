import { Global, Module } from '@nestjs/common';
import { CantexClient } from './cantex-client';

/**
 * Global module untuk Cantex DEX integration.
 *
 * CantexClient adalah singleton yang membawa 2 signer (operator Ed25519 +
 * trading secp256k1) + api_key cache. Di-inject di PartyController untuk
 * endpoint swap (Phase 1: read-only pools/quote; Phase 2: execution).
 *
 * Konstruktor CantexClient lazy-throw bila CANTEX_ENABLED=false → supaya API
 * tetap start tanpa key. Endpoint swap yang butuh client wajib cek
 * `isCantexEnabled()` lebih dulu.
 */
@Global()
@Module({
  providers: [
    {
      provide: CantexClient,
      useFactory: () => {
        // Lazy: hanya instantiate bila enabled. Bila tidak, return proxy yang
        // throw pesan jelas saat diakses — sehingga module tetap load aman.
        const enabled = process.env.CANTEX_ENABLED === 'true';
        if (!enabled) {
          // Return object minimal yang throw saat method dipanggil.
          const stub = new Proxy(
            {},
            {
              get: () => () => {
                throw new Error(
                  'Cantex disabled (CANTEX_ENABLED != true). Set keys + enable di .env.',
                );
              },
            },
          );
          return stub as CantexClient;
        }
        return new CantexClient();
      },
    },
  ],
  exports: [CantexClient],
})
export class CantexModule {}
