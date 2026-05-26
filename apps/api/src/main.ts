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
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',').filter(Boolean) ?? [
      'http://localhost:3000',
    ],
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.log(`API running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
}
bootstrap();
