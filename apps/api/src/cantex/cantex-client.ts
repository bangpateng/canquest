/**
 * Cantex DEX REST API client (TypeScript port dari Python SDK `_sdk.py`).
 *
 * Phase 1: auth + read-only methods (getAccountInfo, getPools, getQuote).
 * Phase 2 (swap.service.ts): swap / swapAndConfirm / transferCC.
 *
 * Endpoint reference (base: https://api.cantex.io mainnet):
 *   POST /v1/auth/api-key/begin      — challenge (no auth)
 *   POST /v1/auth/api-key/finish     — verify signature → api_key
 *   GET  /v1/account/info            — balances (auth)
 *   GET  /v2/pools/info              — list pools (auth)
 *   POST /v2/pools/quote             — swap quote (auth)
 *   POST /v1/intent/build/pool/swap  — build swap intent (Phase 2)
 *   POST /v1/intent/submit           — submit signed intent (Phase 2)
 *   POST /v1/ledger/transaction/build/transfer  — build CC transfer (Phase 2)
 *   POST /v1/ledger/transaction/submit          — submit operator-signed tx (Phase 2)
 *
 * Auth: Bearer <api_key>. api_key didapat via challenge-response Ed25519.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { promises as fs } from 'fs';
import {
  AccountInfo,
  CantexApiError,
  CantexAuthError,
  CantexError,
  CantexTimeoutError,
  InstrumentId,
  Pool,
  QuoteFees,
  QuoteLeg,
  QuoteParams,
  QuotePrices,
  SwapQuote,
  TokenBalance,
} from './cantex.types';
import { IntentTradingKeySigner, OperatorKeySigner } from './cantex-signers';
import { getCantexConfig, validateCantexConfig } from './cantex.config';

/** Retryable HTTP statuses (mirror Python `_request`, lines 1384-1466). */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'CantexSDK/1.0';

interface RequestOpts {
  json?: unknown;
  authenticated?: boolean;
  maxRetries?: number;
}

/** Fetch dengan AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CantexTimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    // Network error — retriable.
    throw new CantexError(`Network error: ${(err as Error).message}`, err);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class CantexClient {
  private readonly logger = new Logger(CantexClient.name);
  private operator: OperatorKeySigner | null = null;
  private trading: IntentTradingKeySigner | null = null;
  private readonly baseUrl: string;
  private readonly apiKeyPath: string | null;

  private apiKey: string | null = null;
  private authPromise: Promise<string> | null = null; // serialize concurrent auth

  constructor() {
    // PRINSIP: constructor TIDAK pernah throw. Config dibaca apa adanya;
    // signer di-instantiate LAZY saat pertama kali dipakai (ensureReady()).
    const cfg = getCantexConfig();
    this.baseUrl = cfg.apiBaseUrl;
    this.apiKeyPath = cfg.apiKeyPath;
  }

  /**
   * Lazy-init signer + validasi config. Dipanggil sebelum operasi Cantex
   * manapun. Throw CantexError bila config belum lengkap.
   */
  private ensureReady(): void {
    if (this.operator && this.trading) return;
    const cfg = getCantexConfig();
    const err = validateCantexConfig(cfg);
    if (err) {
      throw new CantexError(`Cantex tidak siap: ${err}`);
    }
    this.operator = OperatorKeySigner.fromHex(cfg.operatorKeyHex);
    this.trading = IntentTradingKeySigner.fromHex(cfg.tradingKeyHex);
  }

  // ── Public: intent trading public key (untuk create_intent_account Phase 2) ──
  getTradingPublicKeyHexDer(): string {
    this.ensureReady();
    return this.trading!.getPublicKeyHexDer();
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  /**
   * Authenticate (challenge-response Ed25519) → dapatkan api_key.
   * Port Python `authenticate()` (lines 1470-1515).
   * Idempotent: cache in-memory + file. Serialize concurrent calls.
   */
  async authenticate(force = false): Promise<string> {
    this.ensureReady(); // lazy-init signer + validasi config
    if (this.apiKey && !force) {
      // Probe cache validity.
      try {
        await this.request('GET', '/v1/account/info', { authenticated: true });
        return this.apiKey;
      } catch {
        this.apiKey = null; // cache invalid → re-auth
      }
    }
    // Load dari file bila belum di-mem.
    if (!this.apiKey) {
      const fromFile = await this.loadApiKeyFromFile();
      if (fromFile) {
        this.apiKey = fromFile;
        return this.authenticate(false); // probe
      }
    }
    // Serialize: bila auth lagi berjalan, tunggu.
    if (this.authPromise) return this.authPromise;
    this.authPromise = this.runAuthFlow();
    try {
      return await this.authPromise;
    } finally {
      this.authPromise = null;
    }
  }

  private async runAuthFlow(): Promise<string> {
    this.ensureReady();
    const publicKey = this.operator!.getPublicKeyB64();
    // 1. Begin challenge.
    const begin = await this.request<{ message: string; challengeId: string }>(
      'POST',
      '/v1/auth/api-key/begin',
      { json: { publicKey }, authenticated: false },
    );
    if (!begin.message || !begin.challengeId) {
      throw new CantexAuthError(
        `Auth begin missing message/challengeId: ${JSON.stringify(begin)}`,
      );
    }
    // 2. Sign challenge message (UTF-8 bytes).
    const sig = this.operator!.signSync(Buffer.from(begin.message, 'utf8'));
    // 3. Finish → api_key.
    const finish = await this.request<{ api_key: string }>(
      'POST',
      '/v1/auth/api-key/finish',
      {
        json: {
          challengeId: begin.challengeId,
          signature: sig.toString('base64url'),
        },
        authenticated: false,
      },
    );
    if (!finish.api_key) {
      throw new CantexAuthError(
        `Auth finish missing api_key: ${JSON.stringify(finish)}`,
      );
    }
    this.apiKey = finish.api_key;
    await this.persistApiKey(this.apiKey);
    this.logger.log('Authenticated to Cantex API.');
    return this.apiKey;
  }

  private async loadApiKeyFromFile(): Promise<string | null> {
    if (!this.apiKeyPath) return null;
    try {
      const data = await fs.readFile(this.apiKeyPath, 'utf8');
      const key = data.trim();
      return key || null;
    } catch {
      return null;
    }
  }

  private async persistApiKey(key: string): Promise<void> {
    if (!this.apiKeyPath) return;
    try {
      await fs.writeFile(this.apiKeyPath, key, { mode: 0o600 });
    } catch (err) {
      this.logger.warn(
        `Gagal persist api_key ke ${this.apiKeyPath}: ${(err as Error).message}`,
      );
    }
  }

  /** Dapat header Authorization. Auto-auth bila belum ada. */
  private async authHeaders(): Promise<Record<string, string>> {
    const key = this.apiKey ?? (await this.authenticate());
    return { Authorization: `Bearer ${key}` };
  }

  // ── Low-level request (with retry) ────────────────────────────────────

  /**
   * Request dengan retry exp backoff. Port Python `_request` (lines 1384-1466).
   * Parse JSON response. Throw typed error pada failure.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOpts = {},
  ): Promise<T> {
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelay = DEFAULT_BASE_DELAY_MS;
    let attempt = 0;

    while (true) {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (opts.authenticated !== false) {
        const authH = await this.authHeaders();
        Object.assign(headers, authH);
      }
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const init: RequestInit = {
        method,
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      };
      try {
        const res = await fetchWithTimeout(this.baseUrl + path, init);
        if (res.status >= 200 && res.status < 300) {
          const text = await res.text();
          return (text ? JSON.parse(text) : null) as T;
        }
        // Non-2xx.
        const bodyText = await res.text().catch(() => '');
        let bodyParsed: unknown = bodyText;
        try {
          bodyParsed = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          /* keep raw */
        }
        if (res.status === 401 || res.status === 403) {
          // Invalidate cache; biarkan caller re-auth bila perlu.
          this.apiKey = null;
          throw new CantexAuthError(
            `Cantex auth error ${res.status}: ${bodyText.slice(0, 200)}`,
          );
        }
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          await this.backoff(baseDelay, attempt);
          attempt++;
          continue;
        }
        throw new CantexApiError(
          `Cantex API ${res.status}: ${bodyText.slice(0, 300)}`,
          res.status,
          bodyParsed,
        );
      } catch (err) {
        // Network / timeout → retriable.
        if (
          (err instanceof CantexError && !(err instanceof CantexApiError)) ||
          err instanceof CantexTimeoutError
        ) {
          if (attempt < maxRetries) {
            await this.backoff(baseDelay, attempt);
            attempt++;
            continue;
          }
        }
        throw err;
      }
    }
  }

  private backoff(baseDelay: number, attempt: number): Promise<void> {
    const delay = baseDelay * Math.pow(2, attempt);
    return new Promise((r) => setTimeout(r, delay));
  }

  // ── Read methods (Phase 1 — live, read-only) ──────────────────────────

  /** GET /v1/account/info → balances trading account. */
  async getAccountInfo(): Promise<AccountInfo> {
    const raw = await this.request<RawAccountInfo>('GET', '/v1/account/info');
    return parseAccountInfo(raw);
  }

  /** GET /v2/pools/info → semua pool AMM. */
  async getPools(): Promise<Pool[]> {
    const raw = await this.request<RawPoolsInfo>('GET', '/v2/pools/info');
    return (raw.pools ?? []).map(parsePool);
  }

  /**
   * Daftar instrumen yang punya pool CC (salah satu leg = CC/Amulet).
   * Dipakai frontend untuk token picker swap.
   */
  async getSwappableTokens(
    ccInstrument: InstrumentId,
  ): Promise<InstrumentId[]> {
    const pools = await this.getPools();
    const seen = new Map<string, InstrumentId>();
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        if (
          leg.id.toLowerCase() === ccInstrument.id.toLowerCase() &&
          leg.admin.toLowerCase() === ccInstrument.admin.toLowerCase()
        ) {
          continue; // CC leg itself, skip
        }
        const key = `${leg.id}::${leg.admin}`;
        if (!seen.has(key)) seen.set(key, leg);
      }
    }
    return [...seen.values()];
  }

  /**
   * SEMUA instrumen unik dari semua pool AMM Cantex (termasuk Amulet/CC).
   * Dipakai frontend untuk token picker yang fleksibel — user bisa pilih
   * token mana pun di slot atas ATAU bawah (model DEX proper seperti
   * Uniswap/Cantex), bukan hardcode CC ↔ token lain.
   */
  async getAllSwapInstruments(): Promise<InstrumentId[]> {
    const pools = await this.getPools();
    const seen = new Map<string, InstrumentId>();
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        const key = `${leg.id}::${leg.admin}`;
        if (!seen.has(key)) seen.set(key, leg);
      }
    }
    return [...seen.values()];
  }

  /** POST /v2/pools/quote → live swap quote. */
  async getQuote(params: QuoteParams): Promise<SwapQuote> {
    const raw = await this.request<RawSwapQuote>('POST', '/v2/pools/quote', {
      json: {
        sellAmount: params.sellAmount,
        sellInstrumentId: params.sellInstrumentId,
        sellInstrumentAdmin: params.sellInstrumentAdmin,
        buyInstrumentId: params.buyInstrumentId,
        buyInstrumentAdmin: params.buyInstrumentAdmin,
      },
    });
    return parseSwapQuote(raw);
  }

  // ── Token prices (Cantex DEX rate vs USDCx anchor) ─────────────────────

  private pricesCache: { at: number; data: TokenPriceMap } | null = null;
  private static readonly PRICES_TTL_MS = 30_000; // 30s cache

  /**
   * Harga USD semua token dari Cantex DEX (rate token→USDCx).
   * USDCx diasumsikan = $1 (stablecoin anchor).
   *
   * Strategy: untuk tiap token non-USDCx, quote(1 token → USDCx) → trade price.
   * Cache 30 detik supaya tidak overload API. Fail-tolerant: token yang quote-nya
   * error di-skip (tetap ada di map dengan harga null).
   */
  async getTokenPrices(): Promise<TokenPriceMap> {
    // Cache check.
    if (
      this.pricesCache &&
      Date.now() - this.pricesCache.at < CantexClient.PRICES_TTL_MS
    ) {
      return this.pricesCache.data;
    }

    const pools = await this.getPools();
    const usdcx = this.findUsdcx(pools);
    const prices: TokenPriceMap = {};

    if (usdcx) {
      // USDCx itu sendiri = $1.
      prices[`${usdcx.id}::${usdcx.admin}`] = 1;

      // Quote tiap token unik vs USDCx.
      const allInstruments = this.allPoolInstruments(pools);
      await Promise.all(
        allInstruments
          .filter(
            (inst) =>
              !(
                inst.id === usdcx.id &&
                inst.admin.toLowerCase() === usdcx.admin.toLowerCase()
              ),
          )
          .map(async (inst) => {
            try {
              const quote = await this.getQuote({
                sellAmount: '1',
                sellInstrumentId: inst.id,
                sellInstrumentAdmin: inst.admin,
                buyInstrumentId: usdcx.id,
                buyInstrumentAdmin: usdcx.admin,
              });
              prices[`${inst.id}::${inst.admin}`] = parseFloat(
                quote.returned.amount.toString(),
              );
            } catch (err) {
              this.logger.debug(
                `Price quote failed for ${inst.id}: ${(err as Error).message}`,
              );
              // Skip — token tetap ada di map tanpa harga (undefined).
            }
          }),
      );
    }

    this.pricesCache = { at: Date.now(), data: prices };
    return prices;
  }

  /** Cari USDCx instrument dari daftar pool. */
  private findUsdcx(pools: Pool[]): InstrumentId | null {
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        if (leg.id.toUpperCase() === 'USDCX') return leg;
      }
    }
    return null;
  }

  /** Semua instrumen unik dari semua pool. */
  private allPoolInstruments(pools: Pool[]): InstrumentId[] {
    const seen = new Map<string, InstrumentId>();
    for (const p of pools) {
      for (const leg of [p.tokenA, p.tokenB]) {
        const key = `${leg.id}::${leg.admin}`;
        if (!seen.has(key)) seen.set(key, leg);
      }
    }
    return [...seen.values()];
  }
}

/** Map token price: key = "<id>::<admin>", value = USD price (number). */
export type TokenPriceMap = Record<string, number>;

// ── Raw response shapes (server uses snake_case) ────────────────────────

interface RawAccountInfo {
  party_id?: { address?: string };
  address?: string;
  user_id?: string;
  balances?: RawTokenBalance[];
  tokens?: RawTokenBalance[];
}
interface RawTokenBalance {
  instrument_id?: string;
  instrument_admin?: string;
  instrument_name?: string;
  instrument_symbol?: string;
  unlocked_amount?: string;
  locked_amount?: string;
  pending_deposit_transfers?: { contract_id?: string }[];
  pending_withdraw_transfers?: { contract_id?: string }[];
  expired_allocations?: { contract_id?: string }[];
}
interface RawPoolsInfo {
  pools?: RawPool[];
}
interface RawPool {
  contract_id?: string;
  token_a_instrument_id?: string;
  token_a_instrument_admin?: string;
  token_b_instrument_id?: string;
  token_b_instrument_admin?: string;
}
interface RawSwapQuote {
  sell_amount?: string;
  sell_instrument_id?: string;
  sell_instrument_admin?: string;
  buy_instrument_id?: string;
  buy_instrument_admin?: string;
  returned?: RawQuoteLeg;
  pool_size?: RawQuoteLeg;
  fees?: RawQuoteFees;
  prices?: RawQuotePrices;
  estimated_time_seconds?: number;
}
interface RawQuoteLeg {
  amount?: string;
  instrument_id?: string;
  instrument_admin?: string;
}
interface RawQuoteFees {
  fee_percentage?: string;
  amount_admin?: string;
  amount_liquidity?: string;
  instrument_id?: string;
  instrument_admin?: string;
  network_fee?: RawQuoteLeg;
}
interface RawQuotePrices {
  pool_after?: string;
  pool_before?: string;
  slippage?: string;
  trade?: string;
  trade_no_fees?: string;
}

// ── Parsers ─────────────────────────────────────────────────────────────

function instr(
  id: string | undefined,
  admin: string | undefined,
): InstrumentId {
  return { id: id ?? '', admin: admin ?? '' };
}

function parseTokenBalance(r: RawTokenBalance): TokenBalance {
  return {
    instrument: instr(r.instrument_id, r.instrument_admin),
    instrumentName: r.instrument_name ?? '',
    instrumentSymbol: r.instrument_symbol ?? '',
    unlockedAmount: new Decimal(r.unlocked_amount ?? '0'),
    lockedAmount: new Decimal(r.locked_amount ?? '0'),
    pendingDepositTransferCids: (r.pending_deposit_transfers ?? []).map(
      (x) => x.contract_id ?? '',
    ),
    pendingWithdrawTransferCids: (r.pending_withdraw_transfers ?? []).map(
      (x) => x.contract_id ?? '',
    ),
    expiredAllocationCids: (r.expired_allocations ?? []).map(
      (x) => x.contract_id ?? '',
    ),
  };
}

function parseAccountInfo(r: RawAccountInfo): AccountInfo {
  const balances = r.balances ?? r.tokens ?? [];
  return {
    address: r.party_id?.address ?? r.address ?? '',
    userId: r.user_id ?? '',
    tokens: balances.map(parseTokenBalance),
  };
}

function parsePool(r: RawPool): Pool {
  return {
    contractId: r.contract_id ?? '',
    tokenA: instr(r.token_a_instrument_id, r.token_a_instrument_admin),
    tokenB: instr(r.token_b_instrument_id, r.token_b_instrument_admin),
  };
}

function parseQuoteLeg(r: RawQuoteLeg | undefined): QuoteLeg {
  return {
    amount: new Decimal(r?.amount ?? '0'),
    instrument: instr(r?.instrument_id, r?.instrument_admin),
  };
}

function parseQuoteFees(r: RawQuoteFees | undefined): QuoteFees {
  return {
    feePercentage: new Decimal(r?.fee_percentage ?? '0'),
    amountAdmin: new Decimal(r?.amount_admin ?? '0'),
    amountLiquidity: new Decimal(r?.amount_liquidity ?? '0'),
    instrument: instr(r?.instrument_id, r?.instrument_admin),
    networkFee: parseQuoteLeg(r?.network_fee),
  };
}

function parseQuotePrices(r: RawQuotePrices | undefined): QuotePrices {
  return {
    poolAfter: new Decimal(r?.pool_after ?? '0'),
    poolBefore: new Decimal(r?.pool_before ?? '0'),
    slippage: new Decimal(r?.slippage ?? '0'),
    trade: new Decimal(r?.trade ?? '0'),
    tradeNoFees: new Decimal(r?.trade_no_fees ?? '0'),
  };
}

function parseSwapQuote(r: RawSwapQuote): SwapQuote {
  return {
    sellAmount: new Decimal(r.sell_amount ?? '0'),
    sellInstrument: instr(r.sell_instrument_id, r.sell_instrument_admin),
    buyInstrument: instr(r.buy_instrument_id, r.buy_instrument_admin),
    returned: parseQuoteLeg(r.returned),
    poolSize: parseQuoteLeg(r.pool_size),
    fees: parseQuoteFees(r.fees),
    prices: parseQuotePrices(r.prices),
    estimatedTimeSeconds: r.estimated_time_seconds ?? 0,
  };
}
