import {
  Controller,
  Get,
  Query,
  Res,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response, Request } from 'express';
import { RealtimeService } from './realtime.service';

type SseTokenPayload = { sub: string; kind?: string };

/**
 * SSE endpoint: `/api/realtime/stream?token=<sse-token>`.
 *
 * Browser EventSource tidak bisa set header Authorization, jadi token SSE
 * ephemeral (60s, kind:'sse') dikirim via query param. Di-mint oleh
 * `POST /auth/sse-token` (yang butuh access token utama).
 *
 * Setelah terhubung, server PUSH event ke browser ini saat data user berubah
 * (transaksi baru, balance berubah). Frontend terjemahkan event → invalidate
 * cache TanStack Query → UI update instan.
 *
 * Catatan nginx: butuh `proxy_buffering off` + `proxy_read_timeout` panjang.
 * Lihat infra/nginx/canquest-api.conf.
 */
@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);
  /** Heartbeat tiap 30s menjaga koneksi hidup & mendeteksi klien mati. */
  private static readonly HEARTBEAT_MS = 30_000;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
  ) {}

  @Get('stream')
  stream(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): void {
    // ── Auth: verify token SSE ephemeral ────────────────────────────────────
    if (!token) {
      throw new UnauthorizedException('Missing SSE token');
    }
    let payload: SseTokenPayload;
    try {
      payload = this.jwt.verify<SseTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired SSE token');
    }
    if (payload.kind !== 'sse' || !payload.sub) {
      throw new UnauthorizedException('Not an SSE token');
    }
    const userId = payload.sub;

    // ── Header SSE ───────────────────────────────────────────────────────────
    // X-Accel-Buffering: no → instruksi nginx untuk tidak buffer response ini.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Daftarkan koneksi → siap menerima push.
    this.realtime.addClient(userId, res);

    // Event pembuka: beri tahu klien koneksi sukses (frontend pakai ini untuk
    // menghentikan retry/backoff).
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    // Heartbeat: komentar SSE (baris diawali ":") tiap 30s. Mencegah proxy/idle
    // timeout memutus koneksi & deteksi klien mati (write error → cleanup).
    const heartbeat = setInterval(() => {
      res.write(`:heartbeat ${Date.now()}\n\n`);
    }, RealtimeController.HEARTBEAT_MS);

    // Cleanup saat klien menutup koneksi (tutup tab / putus jaringan).
    const cleanup = () => {
      clearInterval(heartbeat);
      this.realtime.removeClient(userId, res);
      try {
        res.end();
      } catch {
        /* sudah ditutup */
      }
    };
    res.on('close', cleanup);

    this.logger.log(`SSE connected user=${userId} (total=${this.realtime.totalConnections})`);
  }
}
