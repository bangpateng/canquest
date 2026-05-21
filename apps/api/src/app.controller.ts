import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * AppController — health check endpoints.
 * Tidak perlu inject service besar; liveness cukup return { ok: true }.
 * Readiness check dilakukan oleh nginx / k8s probe terpisah.
 */
@Controller('health')
@SkipThrottle()
export class AppController {
  /** GET /api/health — liveness probe */
  @Get()
  ok() {
    return {
      ok: true,
      service: 'canquest-api',
      ts: new Date().toISOString(),
      env: process.env.NODE_ENV ?? 'development',
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
}
