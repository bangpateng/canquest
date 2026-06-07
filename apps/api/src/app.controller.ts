import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { CantonLedgerService } from './canton/canton-ledger.service';
import { SpliceValidatorService } from './canton/splice-validator.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * AppController — health check endpoints.
 * Tidak perlu inject service besar; liveness cukup return { ok: true }.
 * Readiness check dilakukan oleh nginx / k8s probe terpisah.
 */
@Controller('health')
@SkipThrottle()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly splice: SpliceValidatorService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /** GET /api/health — liveness probe */
  @Get()
  ok() {
    const skipOtp = process.env.AUTH_REGISTER_SKIP_OTP === 'true';
    const resendConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
    return {
      ok: true,
      service: 'canquest-api',
      ts: new Date().toISOString(),
      env: process.env.NODE_ENV ?? 'development',
      auth: {
        registerOtpRequired: !skipOtp,
        /** Raw value PM2/Nest sees — must be exactly `false` or unset for OTP emails */
        registerOtpSkipEnv: process.env.AUTH_REGISTER_SKIP_OTP ?? null,
        resendConfigured,
        emailReady: skipOtp || resendConfigured,
      },
    };
  }

  /** GET /api/health/ready — readiness probe (ringan) */
  @Get('ready')
  ready() {
    return {
      ok: true,
      ts: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }

  /** GET /api/health/db — PostgreSQL connectivity check */
  @Get('db')
  async db() {
    const start = Date.now();
    let ok = false;
    let error: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      ok,
      ts: new Date().toISOString(),
      ms: Date.now() - start,
      error: error ?? null,
    };
  }

  /**
   * GET /api/health/canton — diagnose slow wallet/API (Splice + Ledger reachability).
   * Run on VPS: curl -s http://127.0.0.1:3001/api/health/canton | jq
   */
  @Get('canton')
  async canton() {
    const started = Date.now();
    const [spliceReachable, ledgerReachable] = await Promise.all([
      this.splice.isReachable(),
      this.ledger.isReachable(),
    ]);
    const checkMs = Date.now() - started;

    const balanceFromDb = this.config.get<string>('BALANCE_READ_FROM_DB');
    const readFromDb =
      balanceFromDb === undefined || balanceFromDb === '' || balanceFromDb === 'true';

    return {
      ok: spliceReachable && ledgerReachable,
      ts: new Date().toISOString(),
      checkMs,
      splice: {
        reachable: spliceReachable,
        configured: this.splice.isConfigured,
      },
      ledger: {
        reachable: ledgerReachable,
      },
      balance: {
        readFromDb,
        dbMaxAgeMs: Number(this.config.get<string>('BALANCE_DB_MAX_AGE_MS') ?? '60000'),
        backgroundDebounceMs: Number(
          this.config.get<string>('BALANCE_BACKGROUND_DEBOUNCE_MS') ?? '15000',
        ),
      },
      inboundSync: {
        enabled:
          this.config.get<string>('CC_INBOUND_SYNC_ENABLED') !== 'false',
        pollMs: Number(this.config.get<string>('CC_INBOUND_SYNC_POLL_MS') ?? '30000'),
      },
      hint: !spliceReachable
        ? 'Splice unreachable — check WireGuard, CANTON_VALIDATOR_URL, validator on VPS 1.'
        : !ledgerReachable
          ? 'Ledger unreachable — check CANTON_JSON_API_URL and participant tunnel.'
          : readFromDb
            ? 'Canton OK; balance should be fast from DB with background sync.'
            : 'Set BALANCE_READ_FROM_DB=true for faster GET /party/balance.',
    };
  }
}
