#!/usr/bin/env node
/**
 * Pre-launch API audit script.
 *
 * Logs in via /api/auth/login (or uses a supplied bearer token), then walks
 * every user-facing GET endpoint listed below and reports:
 *   - HTTP status
 *   - response time (ms)
 *   - response body (truncated)
 *
 * POST endpoints with side-effects (send-cc, lock, unlock, claim, etc.) are
 * NOT auto-hit — they are listed as "MANUAL TEST" so you can run them by
 * hand from the UI. This avoids accidentally moving real MainNet CC.
 *
 * Usage:
 *   node scripts/audit-api.mjs --base https://canquest.cc --email you@example.com --password 'secret'
 *   node scripts/audit-api.mjs --base https://canquest.cc --token eyJ...    # skip login
 *
 * Requires Node 18+ (global fetch). No dependencies.
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (cur.startsWith('--')) {
      const key = cur.slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith('--') ? next : '';
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const BASE = (args.base || 'https://canquest.cc').replace(/\/$/, '');
const EMAIL = args.email;
const PASSWORD = args.password;
const TOKEN = args.token;
const VERBOSE = 'verbose' in args;

if (!BASE || (!TOKEN && (!EMAIL || !PASSWORD))) {
  console.error(
    'Usage: audit-api.mjs --base <url> [--token <jwt> | --email <e> --password <p>] [--verbose]',
  );
  console.error('Example: audit-api.mjs --base https://canquest.cc --email a@b.c --password hunter2');
  process.exit(1);
}

// ── GET endpoints that are SAFE to auto-hit (read-only, no side effects) ──────
// Path uses literal [param] placeholders; the script substitutes them below.
const SAFE_GET_ENDPOINTS = [
  // Auth & session
  '/api/auth/session',
  '/api/config/public',
  '/api/public/maintenance',

  // User / profile
  '/api/me',
  '/api/points',
  '/api/referral',
  '/api/leaderboard',
  '/api/twitter/status',

  // Party / wallet (require wallet)
  '/api/party/balance',
  '/api/party/cc-price',
  '/api/party/cc-price-history',
  '/api/party/fee-config',
  '/api/party/ledger-status',
  '/api/party/lock-status',
  '/api/party/lock-terms',
  '/api/party/notifications',
  '/api/party/offers',
  '/api/party/preapproval',
  '/api/party/preapproval-status',
  '/api/party/transactions',
  '/api/party/transactions/onchain',
  '/api/party/username',
  '/api/party/wallet-access',

  // Quests (read-only)
  '/api/quests',
  '/api/quests/activity',
  '/api/quests/dashboard-stats',
  '/api/quests/earn-hub',
  '/api/quests/leaderboard',
  '/api/quests/my-progress',
];

// ── POST / mutation endpoints — MANUAL TEST only (side effects on MainNet) ────
const MANUAL_TEST_ENDPOINTS = [
  { method: 'POST', path: '/api/party/send-cc',        note: 'Sends real CC. Test from UI.' },
  { method: 'POST', path: '/api/party/lock',            note: 'Locks real CC. Test from UI.' },
  { method: 'POST', path: '/api/party/unlock',          note: 'Unlocks CC. Test from UI.' },
  { method: 'POST', path: '/api/party/offers/accept',   note: 'Accepts pending offer. Test from UI.' },
  { method: 'POST', path: '/api/party/offers/reject',   note: 'Rejects pending offer. Test from UI.' },
  { method: 'POST', path: '/api/party/preapproval/enable',  note: 'Burns ~1.5 CC fee. Test from UI.' },
  { method: 'POST', path: '/api/party/preapproval/disable', note: 'Disables preapproval. Test from UI.' },
  { method: 'POST', path: '/api/party/allocate',        note: 'Onboards wallet. Heavy. Test from UI.' },
  { method: 'POST', path: '/api/quests/[questId]/submit', note: 'Submit quest. Test from UI.' },
  { method: 'POST', path: '/api/quests/[questId]/claim-fcfs', note: 'Claim reward. Test from UI.' },
  { method: 'POST', path: '/api/quests/[questId]/claim-draw-cc', note: 'Claim reward. Test from UI.' },
  { method: 'POST', path: '/api/quests/[questId]/claim-invite', note: 'Claim invite. Test from UI.' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function color(code, str) {
  return `\x1b[${code}m${str}\x1b[0m`;
}
const green = (s) => color('32', s);
const red = (s) => color('31', s);
const yellow = (s) => color('33', s);
const cyan = (s) => color('36', s);
const gray = (s) => color('90', s);

function statusColor(status) {
  if (status >= 200 && status < 300) return green(`${status}`);
  if (status >= 400 && status < 500) return yellow(`${status}`);
  if (status >= 500) return red(`${status}`);
  return String(status);
}

function truncate(s, n = 120) {
  if (!s) return '';
  const oneLine = String(s).replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
}

async function login() {
  console.log(cyan(`\n🔐 Logging in to ${BASE}/api/auth/login as ${EMAIL}…`));
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

  // Backend returns token in body JSON: { accessToken: "..." } OR { access_token: "..." }
  // Some setups also set cq_access cookie. Try body first, fallback to cookie.
  const tokenFromBody =
    body.accessToken || body.access_token || body.token || body.jwt;
  const setCookie = res.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/cq_access=([^;]+)/);

  const token = tokenFromBody || (cookieMatch ? cookieMatch[1] : null);
  if (!token) {
    console.error(
      red(`✗ Login failed (${res.status}) in ${elapsed}ms — no token in response.`),
    );
    console.error(gray(`   Response: ${truncate(text, 200)}`));
    process.exit(2);
  }
  console.log(green(`✓ Login OK in ${elapsed}ms — token captured.`));
  return token;
}

async function hit(path, token) {
  const url = `${BASE}${path}`;
  const headers = {
    Cookie: `cq_access=${token}`,
    // BFF reads cookie but also accepts Authorization for some paths.
    Authorization: `Bearer ${token}`,
  };
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const elapsed = Date.now() - t0;
    const text = await res.text();
    return { status: res.status, elapsed, body: text, url };
  } catch (err) {
    const elapsed = Date.now() - t0;
    return {
      status: 0,
      elapsed,
      body: String(err),
      url,
      networkError: true,
    };
  }
}

function classify(status, body) {
  if (status === 0) return 'NETWORK_ERROR';
  if (status === 401) return 'AUTH_FAIL';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502) return 'UPSTREAM_DOWN';
  if (status === 503) return 'MAINTENANCE';
  if (status >= 500) return 'SERVER_ERROR';
  if (status >= 200 && status < 300) return 'OK';
  return 'OTHER';
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  let token = TOKEN;
  if (!token) {
    token = await login();
  } else {
    console.log(cyan(`\n🎟  Using supplied bearer token (skipping login).`));
  }

  console.log(cyan(`\n▶ Auditing ${SAFE_GET_ENDPOINTS.length} GET endpoints at ${BASE}\n`));

  const results = [];
  for (const path of SAFE_GET_ENDPOINTS) {
    const r = await hit(path, token);
    const kind = classify(r.status, r.body);
    results.push({ path, ...r, kind });

    const statusStr = r.networkError
      ? red('NET')
      : statusColor(r.status);
    const symbol = r.status >= 200 && r.status < 300 ? green('✓') : red('✗');
    console.log(
      `${symbol} ${statusStr.padEnd(6)} ${String(r.elapsed).padStart(5)}ms  ${gray(path)}`,
    );
    if (VERBOSE || r.status >= 400) {
      console.log(gray(`       ${truncate(r.body, 200)}`));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.kind === 'OK');
  const errors = results.filter((r) => r.kind !== 'OK');
  const slow = results.filter((r) => r.elapsed > 3000);

  console.log(cyan('\n════════════════════════════════════════════════════════'));
  console.log(cyan('  SUMMARY'));
  console.log(cyan('════════════════════════════════════════════════════════'));
  console.log(`  Total GET endpoints: ${results.length}`);
  console.log(`  ${green('✓ OK (2xx)')}:           ${ok.length}`);
  console.log(`  ${red('✗ Errors')}:           ${errors.length}`);
  console.log(`  ${yellow('⏱  Slow (>3s)')}:       ${slow.length}`);

  if (errors.length > 0) {
    console.log(red('\n── FAILED ENDPOINTS ──────────────────────────────────'));
    for (const r of errors) {
      const statusStr = r.networkError ? 'NET' : `${r.status}`;
      console.log(
        `  ${red('✗')} [${statusStr}] ${r.path}  — ${r.kind}  (${truncate(r.body, 100)})`,
      );
    }
  }

  if (slow.length > 0) {
    console.log(yellow('\n── SLOW ENDPOINTS (>3s) ─────────────────────────────'));
    for (const r of slow) {
      console.log(`  ${yellow('⏱')}  ${r.elapsed}ms  ${r.path}`);
    }
  }

  // ── Manual test reminder ───────────────────────────────────────────────────
  console.log(cyan('\n── MANUAL TEST NEEDED (POST/mutation — side effects) ──'));
  console.log(gray('  These move real MainNet CC. Test from the UI, not this script.'));
  for (const e of MANUAL_TEST_ENDPOINTS) {
    console.log(`  ${yellow('☞')} ${e.method.padEnd(5)} ${e.path}`);
    console.log(gray(`         ${e.note}`));
  }

  console.log('\n');
  if (errors.length === 0) {
    console.log(green('🎉 All GET endpoints healthy. Proceed to manual POST tests.'));
    process.exit(0);
  } else {
    console.log(red(`⚠️  ${errors.length} endpoint(s) need attention. See FAILED ENDPOINTS above.`));
    process.exit(3);
  }
})();
