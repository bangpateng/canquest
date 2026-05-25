import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Rate-limit tiers untuk CanQuest API.
 *
 * Tiga tier berbeda:
 *   - default : endpoint umum (quests, leaderboard, dll)
 *   - auth    : register/login — ketat untuk cegah brute-force
 *   - ledger  : POST wallet/Canton mutasi saja (send-cc, allocate) — 10/mnt di controller
 *               GET balance/ledger-status pakai tier default (120/mnt), bukan ledger tier
 *
 * Digunakan via @Throttle({ auth: ... }) / @Throttle({ ledger: ... }) di controller.
 * Default tier otomatis berlaku untuk semua endpoint tanpa decorator.
 */
export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'default',
      ttl: 60_000,   // 1 menit
      limit: 120,    // 120 req/menit per IP (2 req/detik)
    },
    {
      name: 'auth',
      ttl: 60_000,   // 1 menit
      limit: 10,     // 10 percobaan login/register per menit per IP
    },
    {
      name: 'ledger',
      ttl: 60_000,   // 1 menit
      limit: 30,     // 30 ledger operations per menit per IP
    },
  ],
};
