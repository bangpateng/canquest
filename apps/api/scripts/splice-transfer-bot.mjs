#!/usr/bin/env node
/**
 * Splice Transfer Bot — Auto-Accept Incoming CC TransferOffers
 *
 * Runs as a standalone Node.js background worker on VPS 2.
 * Connects to VPS 1 Splice Validator API via SSH tunnel.
 *
 * Responsibilities:
 *   1. sendCc(receiverPartyId, amount, description) — create a TransferOffer
 *   2. startAutoAccept(pollIntervalMs) — poll pending incoming offers & auto-accept
 *
 * Usage:
 *   node apps/api/scripts/splice-transfer-bot.mjs
 *   node apps/api/scripts/splice-transfer-bot.mjs --poll-interval=5000
 *
 * PM2:
 *   pm2 start infra/pm2.ecosystem.config.js --only splice-transfer-bot --env production
 *
 * Env vars (set in apps/api/.env or via PM2 env_production):
 *   SPLICE_VALIDATOR_URL=http://localhost:5012   # tunnel to VPS 1 (validator API)
 *   SPLICE_VALIDATOR_HOST_HEADER=wallet.localhost # nginx host header on VPS 1
 *   CANTON_SPLICE_SECRET=unsafe                  # shared JWT secret
 *   SPLICE_BOT_USERNAME=administrator            # wallet username to act as
 *   SPLICE_BOT_AUTO_ACCEPT=true                  # enable auto-accept polling
 *   SPLICE_BOT_POLL_INTERVAL_MS=10000            # polling interval (default 10s)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ────────────────────────────────────────────────────────────────────────────
// 1. Env loader (reads apps/api/.env)
// ────────────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function loadEnv(path) {
  const env = { ...process.env };
  try {
    const content = readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!env[key]) env[key] = val;
    }
  } catch { /* .env not found, use process.env */ }
  return env;
}

const env = loadEnv(resolve(REPO_ROOT, 'apps', 'api', '.env'));

// ────────────────────────────────────────────────────────────────────────────
// 2. Configuration
// ────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  baseUrl: (env.SPLICE_VALIDATOR_URL ?? 'http://localhost:5012').replace(/\/$/, ''),
  hostHeader: env.SPLICE_VALIDATOR_HOST_HEADER ?? 'wallet.localhost',
  secret: env.CANTON_SPLICE_SECRET ?? null,
  botUsername: env.SPLICE_BOT_USERNAME ?? 'administrator',
  autoAccept: (env.SPLICE_BOT_AUTO_ACCEPT ?? 'true').toLowerCase() !== 'false',
  pollIntervalMs: parseInt(env.SPLICE_BOT_POLL_INTERVAL_MS ?? '10000', 10) || 10000,
  // CLI override
  ...parseCliArgs(),
};

function parseCliArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--no-auto-accept') out.autoAccept = false;
    const m = arg.match(/^--poll-interval=(\d+)$/);
    if (m) out.pollIntervalMs = parseInt(m[1], 10);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. JWT Auth (same pattern as SpliceValidatorService)
// ────────────────────────────────────────────────────────────────────────────
const walletAudiences = () => [
  ...new Set([
    env.CANTON_SPLICE_WALLET_AUDIENCE,
    env.CANTON_SPLICE_AUDIENCE,
    'https://validator.example.com',
    'https://canton.network.global',
  ].filter(Boolean)),
];

function signToken(subject, audience) {
  if (!CONFIG.secret) throw new Error('CANTON_SPLICE_SECRET is not set');
  // HS256 JWT — simple base64url-encoded header + payload + signature
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ sub: subject, aud: audience, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 });
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', CONFIG.secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function walletAuthHeaders(username) {
  const aud = walletAudiences()[0] ?? 'https://validator.example.com';
  const token = signToken(username, aud);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (CONFIG.hostHeader) headers['Host'] = CONFIG.hostHeader;
  return headers;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Logger
// ────────────────────────────────────────────────────────────────────────────
const log = (level, msg, data) => {
  const ts = new Date().toISOString();
  const prefix = `[splice-bot][${level.toUpperCase()}] ${ts}`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, typeof data === 'string' ? data : JSON.stringify(data));
  } else {
    console.log(`${prefix} ${msg}`);
  }
};

const logger = {
  info: (m, d) => log('info', m, d),
  warn: (m, d) => log('warn', m, d),
  error: (m, d) => log('error', m, d),
  success: (m, d) => log('success', m, d),
};

// ────────────────────────────────────────────────────────────────────────────
// 5. Core Functions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a TransferOffer from the bot's wallet to a receiver.
 *
 * POST /api/validator/v0/wallet/transfer-offers
 *
 * @param {string} receiverPartyId - Canton Party ID penerima
 * @param {number} amountCc - jumlah CC (misal 10.5)
 * @param {string} description - memo
 * @returns {Promise<{ok: boolean, offerContractId?: string, error?: string}>}
 */
export async function sendCc(receiverPartyId, amountCc, description = 'CanQuest transfer') {
  if (!CONFIG.secret) {
    return { ok: false, error: 'CANTON_SPLICE_SECRET is not set. Cannot sign auth token.' };
  }

  const trackingId = crypto.randomUUID();
  const nowMicros = BigInt(Date.now()) * 1_000n;
  const sevenDaysMicros = 7n * 24n * 3_600n * 1_000_000n;
  const expiresAtMicros = nowMicros + sevenDaysMicros;

  const url = `${CONFIG.baseUrl}/api/validator/v0/wallet/transfer-offers`;

  logger.info(`Creating TransferOffer: ${amountCc} CC → ${receiverPartyId.split('::')[0]}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: walletAuthHeaders(CONFIG.botUsername),
      body: JSON.stringify({
        receiver_party_id: receiverPartyId,
        amount: amountCc.toString(),
        description,
        expires_at: Number(expiresAtMicros),
        tracking_id: trackingId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();

    if (!res.ok) {
      logger.warn(`createTransferOffer HTTP ${res.status}: ${text.slice(0, 300)}`);
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = JSON.parse(text);
    const offerContractId = data?.offer_contract_id ?? null;

    if (offerContractId) {
      logger.success(`TransferOffer created: ${offerContractId.slice(0, 20)}… (${amountCc} CC → ${receiverPartyId.split('::')[0]})`);
      return { ok: true, offerContractId };
    }

    logger.warn(`TransferOffer created but no contract_id in response: ${text.slice(0, 200)}`);
    return { ok: true, offerContractId: null, warning: 'No contract ID in response' };
  } catch (err) {
    const msg = String(err);
    logger.error(`sendCc failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * List pending transfer offers for the bot's wallet.
 *
 * GET /api/validator/v0/wallet/transfer-offers
 *
 * @returns {Promise<{contractId: string, payload: unknown}[]>}
 */
async function listIncomingOffers() {
  if (!CONFIG.secret) return [];

  for (const aud of walletAudiences()) {
    try {
      const headers = { Authorization: `Bearer ${signToken(CONFIG.botUsername, aud)}` };
      if (CONFIG.hostHeader) headers['Host'] = CONFIG.hostHeader;

      const res = await fetch(`${CONFIG.baseUrl}/api/validator/v0/wallet/transfer-offers`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) continue;
        logger.warn(`listTransferOffers HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      const raw = (data?.offers ?? []).map(o => ({
        contractId: o?.contract_id ?? '',
        payload: o?.payload,
      }));

      // Filter: only incoming offers (where receiver matches our wallet)
      const incoming = raw.filter(o => {
        const p = o.payload;
        if (!p) return false;
        const receiver = typeof p.receiver === 'string' ? p.receiver : p.receiver?.id ?? '';
        return receiver && receiver.includes(CONFIG.botUsername);
      });

      return incoming;
    } catch {
      // try next audience
    }
  }
  return [];
}

/**
 * Accept a specific TransferOffer.
 *
 * POST /api/validator/v0/wallet/transfer-offers/{contractId}/accept
 *
 * @param {string} contractId
 * @returns {Promise<boolean>}
 */
async function acceptOffer(contractId) {
  if (!CONFIG.secret) return false;

  const encodedId = encodeURIComponent(contractId);
  const url = `${CONFIG.baseUrl}/api/validator/v0/wallet/transfer-offers/${encodedId}/accept`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: walletAuthHeaders(CONFIG.botUsername),
      body: '{}',
      signal: AbortSignal.timeout(45_000),
    });

    if (res.ok) {
      logger.success(`Offer accepted: ${contractId.slice(0, 20)}…`);
      return true;
    }

    const text = await res.text();
    logger.warn(`acceptOffer failed HTTP ${res.status}: ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    logger.warn(`acceptOffer error: ${String(err)}`);
    return false;
  }
}

/**
 * Get the bot wallet's CC balance.
 *
 * GET /api/validator/v0/wallet/balance
 *
 * @returns {Promise<number | null>}
 */
async function getBalance() {
  if (!CONFIG.secret) return null;
  for (const aud of walletAudiences()) {
    try {
      const headers = { Authorization: `Bearer ${signToken(CONFIG.botUsername, aud)}` };
      if (CONFIG.hostHeader) headers['Host'] = CONFIG.hostHeader;

      const res = await fetch(`${CONFIG.baseUrl}/api/validator/v0/wallet/balance`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) continue;
        return null;
      }

      const data = await res.json();
      return data?.effective_unlocked_qty ? parseFloat(data.effective_unlocked_qty) : 0;
    } catch {
      // try next audience
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 6. Auto-Accept Bot (Background Polling)
// ────────────────────────────────────────────────────────────────────────────
let pollTimer = null;
let isPolling = false;

/**
 * Start the auto-accept polling loop.
 * @param {number} intervalMs - poll interval in milliseconds
 */
export function startAutoAccept(intervalMs = CONFIG.pollIntervalMs) {
  if (!CONFIG.autoAccept) {
    logger.info('Auto-accept disabled (SPLICE_BOT_AUTO_ACCEPT=false or --no-auto-accept). Bot will idle.');
    return;
  }

  if (!CONFIG.secret) {
    logger.error('CANTON_SPLICE_SECRET not set. Auto-accept cannot start.');
    return;
  }

  logger.info(`Starting auto-accept bot. Poll interval: ${intervalMs}ms. Wallet: @${CONFIG.botUsername}`);
  logger.info(`Validator URL: ${CONFIG.baseUrl}`);

  const tick = async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const offers = await listIncomingOffers();

      if (offers.length === 0) {
        // Silent — no pending offers
      } else {
        logger.info(`Found ${offers.length} pending incoming offer(s)`);
        for (const offer of offers) {
          const p = offer.payload ?? {};
          const amount = p?.amount;
          const amountStr = typeof amount?.unassigned === 'string' ? amount.unassigned : typeof amount?.qty === 'string' ? amount.qty : '?';
          const sender = typeof p?.sender === 'string' ? p.sender.split('::')[0] : 'unknown';
          logger.info(`  → ${parseFloat(amountStr) / 1_000_000} CC from ${sender} (offer: ${offer.contractId.slice(0, 20)}…)`);

          const ok = await acceptOffer(offer.contractId);
          if (ok) {
            const bal = await getBalance();
            logger.info(`  ✅ Accepted! New balance: ${bal !== null ? bal.toFixed(4) : 'unknown'} CC`);
          } else {
            logger.warn(`  ❌ Failed to accept offer ${offer.contractId.slice(0, 20)}…`);
          }
        }
      }
    } catch (err) {
      logger.error(`Polling error: ${String(err)}`);
    } finally {
      isPolling = false;
    }
  };

  // Run immediately, then on interval
  tick();
  pollTimer = setInterval(tick, intervalMs);
}

/**
 * Stop the auto-accept polling loop.
 */
export function stopAutoAccept() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Auto-accept bot stopped.');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Health Check
// ────────────────────────────────────────────────────────────────────────────
async function checkHealth() {
  if (!CONFIG.secret) {
    logger.warn('CANTON_SPLICE_SECRET not set — auth will fail.');
    return false;
  }

  // Pattern from SpliceValidatorService.isReachable():
  // Any HTTP response (including 404) means tunnel is up.
  // Try readyz first, then admin/users with auth as fallback.

  const headers = { ...walletAuthHeaders(CONFIG.botUsername) };
  delete headers['Content-Type'];
  if (CONFIG.hostHeader) headers['Host'] = CONFIG.hostHeader;

  // Try readyz first (no auth needed, lightweight)
  try {
    const res = await fetch(`${CONFIG.baseUrl}/api/validator/v0/readyz`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    // Any response (200, 401, 403, 404) = tunnel works — validator responded
    logger.info(`✅ Validator reachable at ${CONFIG.baseUrl} (readyz HTTP ${res.status})`);
    return true;
  } catch (err) {
    // Connection refused — try authenticated fallback
    logger.warn(`Readyz fetch failed: ${String(err).slice(0, 80)}. Trying admin/users...`);
  }

  // Fallback: try authenticated admin endpoint
  try {
    const res = await fetch(`${CONFIG.baseUrl}/api/validator/v0/admin/users`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok || res.status === 401 || res.status === 403) {
      // Any response means tunnel is up (401/403 = auth working, just not admin credentials)
      logger.info(`✅ Validator reachable at ${CONFIG.baseUrl} (admin/users HTTP ${res.status})`);
      return true;
    }
    logger.warn(`Admin/users returned HTTP ${res.status}`);
  } catch (err) {
    logger.warn(`Admin/users fetch failed: ${String(err).slice(0, 80)}`);
  }

  logger.error(`Validator unreachable at ${CONFIG.baseUrl}. Check SSH tunnel.`);
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Main Entry Point
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  logger.info('═══════════════════════════════════════════');
  logger.info('  Splice Transfer Bot — Starting');
  logger.info(`  Base URL:  ${CONFIG.baseUrl}`);
  logger.info(`  Username:  @${CONFIG.botUsername}`);
  logger.info(`  Auto-accept: ${CONFIG.autoAccept ? 'ENABLED' : 'DISABLED'}`);
  logger.info('═══════════════════════════════════════════');

  const healthy = await checkHealth();
  if (!healthy) {
    logger.warn('Validator health check failed. Bot will retry on poll interval.');
  }

  // Show current balance
  const bal = await getBalance();
  if (bal !== null) {
    logger.info(`Current balance: ${bal.toFixed(4)} CC`);
  }

  // Start auto-accept polling
  startAutoAccept();

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`Received ${signal}. Shutting down...`);
    stopAutoAccept();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Fatal: ${String(err)}`);
  process.exit(1);
});