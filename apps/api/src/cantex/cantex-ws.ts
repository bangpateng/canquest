/**
 * Cantex WebSocket client — TypeScript port dari Python SDK CantexWebSocket.
 *
 * Public WS: wss://api.cantex.io/v1/ws/public (no auth).
 * Private WS: wss://api.cantex.io/v1/ws/private (Bearer auth).
 *
 * Protocol (from Python SDK lines 1186-1226):
 *   - Server ping {"op":"ping"} → client reply {"op":"pong"}.
 *   - Subscribe: {"op":"subscribe","channels":["market.CC-USDCx.ticker"]}.
 *   - Ticker frames: keyed by "channel", have data.market + data.price.
 *
 * Reconnect: exp backoff (baseDelay * 2^(attempt-1)), max 5.
 */

import WebSocket from 'ws';
import { Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { TickerEvent } from './cantex.types';

const MAX_RECONNECTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

export type WsFrameHandler = (frame: Record<string, unknown>) => void;

export class CantexWebSocketClient {
  private readonly logger = new Logger(CantexWebSocketClient.name);
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly subscriptions: Set<string> = new Set();
  private closedByUser = false;
  private reconnectAttempts = 0;
  private frameHandler: WsFrameHandler | null = null;

  constructor(
    baseUrl: string,
    private readonly path: string,
    private readonly getAuthHeaders?: () => Record<string, string>,
  ) {
    const wsBase = baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
    this.url = `${wsBase}${path}`;
  }

  /**
   * Connect + mulai listen. Set handler SEBELUM connect.
   * Reconnect otomatis bila connection drop.
   */
  connect(handler: WsFrameHandler): void {
    this.frameHandler = handler;
    this.closedByUser = false;
    this.doConnect();
  }

  /** Subscribe ke channel (re-sent on reconnect). */
  subscribe(channels: string[]): void {
    for (const c of channels) this.subscriptions.add(c);
    this.send({ op: 'subscribe', channels });
  }

  /** Unsubscribe dari channel. */
  unsubscribe(channels: string[]): void {
    for (const c of channels) {
      this.subscriptions.delete(c);
    }
    this.send({ op: 'unsubscribe', channels });
  }

  /** Close connection (no reconnect). */
  close(): void {
    this.closedByUser = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private doConnect(): void {
    const headers = this.getAuthHeaders?.() ?? {};
    this.logger.log(`WS connecting: ${this.url}`);
    this.ws = new WebSocket(this.url, { headers });

    this.ws.on('open', () => {
      this.logger.log(`WS connected: ${this.path}`);
      this.reconnectAttempts = 0;
      // Re-subscribe channels on (re)connect.
      if (this.subscriptions.size > 0) {
        this.send({
          op: 'subscribe',
          channels: [...this.subscriptions],
        });
      }
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      // RawData = Buffer | ArrayBuffer | Buffer[]. toString handles all.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const text = raw.toString();
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(text) as Record<string, unknown>;
      } catch {
        this.logger.warn(`WS invalid JSON: ${text.slice(0, 100)}`);
        return;
      }
      this.handleFrame(frame);
    });

    this.ws.on('close', (code: number) => {
      if (this.closedByUser) {
        this.logger.log(`WS closed (code=${code})`);
        return;
      }
      this.logger.warn(
        `WS closed unexpectedly (code=${code}), reconnecting...`,
      );
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`WS error: ${err.message}`);
      // 'close' event akan follow → reconnect di-schedule di close handler.
    });
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const op = frame['op'] as string | undefined;
    // Ping → pong.
    if (op === 'ping') {
      this.send({ op: 'pong' });
      return;
    }
    // Subscribe/unsubscribe ack → ignore.
    if (op === 'subscribe' || op === 'unsubscribe') return;
    if (op === 'subscribed' || op === 'unsubscribed') return;
    // Business frame → pass to handler.
    this.frameHandler?.(frame);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECTS) {
      this.logger.error(
        `WS reconnect failed after ${MAX_RECONNECTS} attempts. Giving up.`,
      );
      return;
    }
    this.reconnectAttempts++;
    const delay =
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    this.logger.warn(
      `WS reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECTS}) in ${delay}ms...`,
    );
    setTimeout(() => {
      if (!this.closedByUser) this.doConnect();
    }, delay);
  }
}

/**
 * Parse WS frame menjadi TickerEvent (jika frame adalah ticker update).
 * Port dari Python SDK TickerEvent._from_raw (lines 1039-1049).
 * Return null jika bukan ticker frame.
 */
export function parseTickerEvent(
  frame: Record<string, unknown>,
): TickerEvent | null {
  const channel = frame['channel'] as string | undefined;
  if (!channel || !channel.endsWith('.ticker')) return null;
  const data = (frame['data'] ?? {}) as Record<string, unknown>;
  const eventType = (frame['event_type'] as string) ?? 'update';
  return {
    channel,
    market: (data['market'] as string) ?? '',
    price: new Decimal(
      typeof data['price'] === 'number'
        ? String(data['price'])
        : ((data['price'] as string) ?? '0'),
    ),
    priceTs: Number(data['ts'] ?? 0),
    serverTs: Number(frame['ts'] ?? 0),
    eventType: eventType === 'snapshot' ? 'snapshot' : 'update',
  };
}
