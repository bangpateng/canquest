// scripts/test-non-cc-transfer.cjs
// Verifikasi: apakah endpoint Cantex /v1/ledger/transaction/build/transfer
// mendukung instrument NON-CC (mis. USDCx)?
//
// Flow:
//   1. Auth challenge-response ke Cantex (CANTEX_OPERATOR_KEY Ed25519)
//   2. GET /v1/account/info → cek balance USDCx di trading account
//   3. Kirim 0.001 USDCx dari trading account → TEST_RECEIVER_PARTY
//      via POST /v1/ledger/transaction/build/transfer (instrumentId=USDCx)
//   4. Log hasil: SUCCESS (endpoint support non-CC) atau FAIL (CC-only)
//
// NON-DESTRUCTIVE: amount 0.001 (sangat kecil), receiver dari env.
//
// Cara jalan (VPS):
//   cd /var/www/canquest/apps/api && node scripts/test-non-cc-transfer.cjs
//
// Env yang dibutuhkan (dari .env):
//   CANTEX_API_BASE_URL (default https://api.cantex.io)
//   CANTEX_OPERATOR_KEY (64-hex Ed25519)
//   TEST_RECEIVER_PARTY (party id tujuan test, mis. cantex::1220...)

const path = require('path');
const crypto = require('crypto');

// ── Load .env ────────────────────────────────────────────────────────────
let loadedEnv = null;
try {
  const dotenv = require('dotenv');
  for (const p of [
    path.resolve(__dirname, '../.env'),
    '/var/www/canquest/apps/api/.env',
    '/var/www/canquest/.env',
  ]) {
    const r = dotenv.config({ path: p });
    if (!r.error) {
      loadedEnv = p;
      break;
    }
  }
} catch (e) {
  console.log('dotenv?', e.message);
}
console.log('ENV dari:', loadedEnv || '(none)');

if (typeof fetch !== 'function') {
  console.error('FATAL: no global fetch, Node', process.version);
  process.exit(1);
}

const BASE_URL = (process.env.CANTEX_API_BASE_URL || 'https://api.cantex.io').replace(/\/$/, '');
const OPERATOR_HEX = process.env.CANTEX_OPERATOR_KEY || '';
const RECEIVER = process.env.TEST_RECEIVER_PARTY || '';
const USDCX_ID = process.env.CANTEX_USDCX_INSTRUMENT_ID || 'USDCx';
const USDCX_ADMIN = process.env.CANTEX_USDCX_INSTRUMENT_ADMIN || '';

if (!OPERATOR_HEX || OPERATOR_HEX.length !== 64) {
  console.error('FATAL: CANTEX_OPERATOR_KEY belum di-set atau bukan 64 hex chars.');
  process.exit(1);
}
if (!RECEIVER) {
  console.error('FATAL: TEST_RECEIVER_PARTY belum di-set. Contoh: cantex::1220...');
  console.error('        Set di .env atau jalan: TEST_RECEIVER_PARTY=cantex::xxx node scripts/test-non-cc-transfer.cjs');
  process.exit(1);
}

// ── Ed25519 helpers (pakai crypto Node built-in, no external dep) ────────
// node:crypto ed25519: sign + get public key dari raw 32-byte private key.

/** Build PKCS8 DER KeyObject from raw 32-byte Ed25519 private key hex. */
function ed25519KeyObject(privHex) {
  return crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 Ed25519 prefix
      Buffer.from(privHex, 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

function ed25519PublicKeyHex(privHex) {
  // Derive public KeyObject from private, export as SPKI DER (12-byte prefix +
  // 32-byte raw pubkey), then strip prefix to get raw pubkey hex.
  const priv = ed25519KeyObject(privHex);
  const pub = crypto.createPublicKey(priv);
  const spki = pub.export({ type: 'spki', format: 'der' });
  return spki.subarray(spki.length - 32).toString('hex');
}

function ed25519Sign(privHex, data) {
  const keyObj = ed25519KeyObject(privHex);
  return crypto.sign(null, data, keyObj); // null = Ed25519 pure
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── HTTP request helper ──────────────────────────────────────────────────
async function apiReq(method, path, { json, apiKey } = {}) {
  const headers = { 'User-Agent': 'CantexTest/1.0' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: res.status, body: parsed, raw: text };
}

// ── Auth: challenge-response Ed25519 ─────────────────────────────────────
async function authenticate() {
  const pubHex = ed25519PublicKeyHex(OPERATOR_HEX);
  const pubB64 = b64url(Buffer.from(pubHex, 'hex'));

  // 1. Begin challenge.
  const begin = await apiReq('POST', '/v1/auth/api-key/begin', {
    json: { publicKey: pubB64 },
  });
  if (begin.status !== 200 || !begin.body?.message) {
    console.error('AUTH BEGIN failed:', begin.status, begin.raw?.slice(0, 300));
    process.exit(1);
  }
  const { message, challengeId } = begin.body;

  // 2. Sign message (UTF-8 bytes).
  const sig = ed25519Sign(OPERATOR_HEX, Buffer.from(message, 'utf8'));

  // 3. Finish → api_key.
  const finish = await apiReq('POST', '/v1/auth/api-key/finish', {
    json: { challengeId, signature: b64url(sig) },
  });
  if (finish.status !== 200 || !finish.body?.api_key) {
    console.error('AUTH FINISH failed:', finish.status, finish.raw?.slice(0, 300));
    process.exit(1);
  }
  console.log('✓ Authenticated to Cantex');
  return finish.body.api_key;
}

// ── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n=== TEST: Cantex non-CC transfer endpoint ===');
  console.log('Base URL:', BASE_URL);
  console.log('Receiver:', RECEIVER.slice(0, 30) + '...');
  console.log('USDCx instrument:', USDCX_ID, '(admin:', (USDCX_ADMIN || '(empty)').slice(0, 30) + '...)');

  // 1. Auth.
  const apiKey = await authenticate();

  // 2. Cek trading account balance.
  console.log('\n--- Step 2: GET /v1/account/info (trading account balance) ---');
  const info = await apiReq('GET', '/v1/account/info', { apiKey });
  if (info.status !== 200) {
    console.error('account/info failed:', info.status, info.raw?.slice(0, 300));
    process.exit(1);
  }
  const tokens = info.body?.tokens || info.body?.balances || [];
  console.log('Tokens di trading account:', tokens.length);
  let usdcxBalance = null;
  let usdcxAdminFound = '';
  for (const t of tokens) {
    const sym = (t.instrument_id || t.instrumentId || '').toUpperCase();
    // FIX: API nests balance under t.balances.{unlocked,locked}_amount
    const bal = t.balances || {};
    const unlocked = bal.unlocked_amount || t.unlocked_amount || '0';
    const locked = bal.locked_amount || t.locked_amount || '0';
    const pendDep = (t.pending_deposit_transfers || []).length || 0;
    const pendWd = (t.pending_withdraw_transfers || []).length || 0;
    const admin = (t.instrument_admin || t.instrumentAdmin || '').slice(0, 24);
    console.log(`  - ${sym}: unlocked=${unlocked} locked=${locked} pendDep=${pendDep} pendWd=${pendWd} admin=${admin}...`);
    if (sym === USDCX_ID.toUpperCase()) {
      usdcxBalance = unlocked;
      usdcxAdminFound = t.instrument_admin || t.instrumentAdmin || '';
    }
  }

  if (!usdcxBalance || parseFloat(usdcxBalance) < 0.001) {
    console.error(`\n✗ Trading account tidak punya cukup ${USDCX_ID} (perlu ≥ 0.001, punya ${usdcxBalance || '0'}).`);
    console.error('  Lakukan swap CC → USDCx kecil dulu untuk mengisi balance, lalu jalan script ini.');
    console.error('\n  Full account/info response untuk debugging:');
    console.error(JSON.stringify(info.body, null, 2).slice(0, 2000));
    process.exit(1);
  }
  console.log(`\n✓ ${USDCX_ID} balance: ${usdcxBalance} (admin: ${usdcxAdminFound.slice(0, 30)}...)`);

  const effectiveAdmin = USDCX_ADMIN || usdcxAdminFound;
  if (!effectiveAdmin) {
    console.error('\n✗ Tidak dapat instrument_admin USDCx. Set CANTEX_USDCX_INSTRUMENT_ADMIN di .env.');
    process.exit(1);
  }

  // 3. Test transfer 0.001 USDCx.
  console.log('\n--- Step 3: TEST transfer 0.001 USDCx via Cantex endpoint ---');
  console.log('POST /v1/ledger/transaction/build/transfer');
  console.log('  instrumentId:', USDCX_ID);
  console.log('  instrumentAdmin:', effectiveAdmin.slice(0, 30) + '...');
  console.log('  receiver:', RECEIVER.slice(0, 30) + '...');
  console.log('  amount: 0.001');

  const buildPayload = {
    instrumentAdmin: effectiveAdmin,
    instrumentId: USDCX_ID,
    receiver: RECEIVER,
    amount: '0.001',
    memo: 'test-non-cc-transfer',
  };

  const buildRes = await apiReq('POST', '/v1/ledger/transaction/build/transfer', {
    json: buildPayload,
    apiKey,
  });

  console.log('\n--- HASIL VERIFIKASI ---');
  console.log('Build HTTP status:', buildRes.status);

  if (buildRes.status >= 200 && buildRes.status < 300) {
    const buildId = buildRes.body?.id;
    const txHash = buildRes.body?.context?.transaction_hash;
    console.log('Build response id:', buildId);
    console.log('Build tx_hash:', txHash ? '(present, ' + txHash.length + ' chars)' : '(MISSING)');

    if (!buildId || !txHash) {
      console.log('\n⚠ Build OK tapi id/tx_hash tidak ada. Response:');
      console.log(JSON.stringify(buildRes.body, null, 2).slice(0, 1000));
      console.log('\n? INKONKLUSIF — endpoint terima request tapi response aneh. Cek manual.');
      return;
    }

    // Sign + submit.
    const hashBytes = Buffer.from(txHash, 'base64');
    const sig = ed25519Sign(OPERATOR_HEX, hashBytes);
    const submitRes = await apiReq('POST', '/v1/ledger/transaction/submit', {
      json: { id: buildId, operatorKeySignedTransactionHash: b64url(sig) },
      apiKey,
    });
    console.log('Submit HTTP status:', submitRes.status);
    console.log('Submit response:', JSON.stringify(submitRes.body ?? submitRes.raw, null, 2).slice(0, 500));

    if (submitRes.status >= 200 && submitRes.status < 300) {
      console.log('\n✓✓✓ VERIFIED: Endpoint Cantex SUPPORT non-CC transfer!');
      console.log('  0.001', USDCX_ID, 'dikirim ke', RECEIVER.slice(0, 20) + '...');
      console.log('  → Lanjut Fase 2 Langkah 2 (generalisasi transfer).');
    } else {
      console.log('\n⚠ Build OK tapi SUBMIT gagal. Kemungkinan signature issue.');
      console.log('  Investigasi response di atas.');
    }
  } else {
    console.log('\n✗✗✓ VERIFIED: Endpoint Cantex TIDAK support non-CC transfer (atau error lain).');
    console.log('Error body:', buildRes.raw?.slice(0, 500));
    console.log('\n→ Perlu pivot: gunakan Canton ledger transfer langsung (executeTransferFactoryTransfer');
    console.log('  yang digeneralisasi), BUKAN Cantex API endpoint.');
  }
})().catch((err) => {
  console.error('\n✗ Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
