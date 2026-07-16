import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  // Nginx / Vercel BFF send X-Forwarded-For — needed for fair per-user rate limits.
  app.set('trust proxy', 1);

  // ── Security headers (helmet) ─────────────────────────────────────────────
  // Adds X-DNS-Prefetch-Control, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(
    helmet({
      contentSecurityPolicy: false, // managed by Next.js frontend
      crossOriginEmbedderPolicy: false,
      // Allow canquest.cc to embed quest images from api.canquest.cc (<img>, background-image).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ── Global prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Validation ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Allow larger JSON payloads for avatar uploads (base64 data URL up to ~2MB).
  // Default NestJS body parser limit is 100KB which rejects avatar uploads
  // before they reach DTO validation.
  app.use(require('express').json({ limit: '2mb' }));
  app.use(require('express').urlencoded({ limit: '2mb', extended: true }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  // With `credentials: true` the browser REJECTS a wildcard origin, so we must
  // resolve a concrete allow-list. In production WEB_ORIGIN must be set to the
  // exact domain(s) (e.g. https://canquest.cc); an empty/wildcard value would
  // either be rejected by browsers or silently open the API to any origin.
  const rawCorsOrigin = process.env.WEB_ORIGIN?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigin: string[] = rawCorsOrigin?.length
    ? rawCorsOrigin
    : ['http://localhost:3000'];

  if (corsOrigin.includes('*')) {
    logger.error(
      'WEB_ORIGIN="*" is not allowed with credentials:true — refusing to start. ' +
        'Set WEB_ORIGIN to your exact production domain(s).',
    );
    throw new Error(
      'Invalid CORS configuration: wildcard origin with credentials.',
    );
  }
  if (process.env.NODE_ENV === 'production' && !rawCorsOrigin?.length) {
    logger.warn(
      'CORS falling back to localhost in production — set WEB_ORIGIN to the real domain(s).',
    );
  }

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3001);
  // Defense-in-depth (security): bind ke loopback only, BUKAN default 0.0.0.0.
  // Walaupun UFW memblokir port 3001 dari publik, binding eksplisit ke 127.0.0.1
  // memastikan API tidak bisa diakses langsung dari luar VPS meski firewall
  // sempat mati (mis. human error saat restart). Semua traffic publik HARUS
  // lewat nginx proxy — yang membatasi /admin + /api/admin ke 127.0.0.1/::1
  // (hanya tercapai via SSH tunnel). Lihat infra/nginx/canquest.conf & infra/redeploy.sh.
  await app.listen(port, '127.0.0.1');
  logger.log(`API running on http://127.0.0.1:${port} (loopback only)`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
}
bootstrap();
