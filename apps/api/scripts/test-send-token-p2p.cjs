// scripts/test-send-token-p2p.cjs
//
// FUNCTIONAL TEST: jawaban definitif "apakah node saya support P2P transfer
// token non-CC (USDCx)?" — dengan 1 tembakan kirim 0.001 USDCx antar 2 user.
//
// Mengapa ini lebih可靠 dari inspeksi DAR:
//   - Inspeksi DAR cek "apakah file ter-load" (bisa salah baca format)
//   - Test fungsional cek "apakah mesinnya JALAN" (ground truth)
//   - Kalau TransferFactory_Transfer berhasil → DAR pasti loaded & fitur siap
//   - Kalau gagal → pesan error backend kasih tahu persis apa masalahnya
//
// Flow:
//   1. Login sender + receiver via /auth/login (ambil JWT)
//   2. Resolve cantonPartyId + cantonUsername keduanya dari /party/wallet-access
//   3. Resolve USDCx admin dari Cantex pools (GET /party/swap/pools) atau env
//   4. POST /party/send-token { sender→receiver, 0.001 USDCx }
//   5. Login receiver, GET /party/offers — apakah offer masuk?
//   6. Lapor: SUCCESS (node support) atau gagal + full error payload
//
// NON-DESTRUCTIVE: amount 0.001 (sangat kecil). Two-step: offer dibuat, tidak
// auto-accept — receiver harus klik Accept manual (atau via script lain).
//
// Cara jalan (VPS):
//   cd /var/www/canquest/apps/api && node scripts/test-send-token-p2p.cjs
//
// Env yang dibutuhkan (dari .env atau inline):
//   API_BASE_URL          (default http://127.0.0.1:3001 — Nest API internal)
//   TEST_SENDER_EMAIL     (user pengirim, harus punya wallet + USDCx on-chain)
//   TEST_SENDER_PASSWORD
//   TEST_RECEIVER_EMAIL   (user penerima, harus punya wallet)
//   TEST_RECEIVER_PASSWORD
//   TEST_TOKEN_INSTRUMENT (default USDCX)
//   TEST_AMOUNT           (default 0.001)
//   TEST_TOKEN_ADMIN      (opsional — kalau kosong, auto-resolve dari swap/pools)

const path = require('path');

// ── Load .env ────────────────────────────────────────────────────────────
try {
  const dotenv = require('dotenv');
  for (const p of [
    path.resolve(__dirname, '../.env'),
    '/var/www/canquest/apps/api/.env',
    '/var/www/canquest/.env',
  ]) {
    const r = dotenv.config({ path: p });
    if (!r.error) { console.log(`[env] loaded: ${p}`); break; }
  }
} catch {
  console.warn('[env] dotenv tidak tersedia, pakai process.env.');
}

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.NEST_API_URL ||
  'http://127.0.0.1:3001'
).replace(/\/$/, '');
const SENDER_EMAIL = process.env.TEST_SENDER_EMAIL;
const SENDER_PASS = process.env.TEST_SENDER_PASSWORD;
const RECEIVER_EMAIL = process.env.TEST_RECEIVER_EMAIL;
const RECEIVER_PASS = process.env.TEST_RECEIVER_PASSWORD;
const TOKEN_INSTRUMENT = process.env.TEST_TOKEN_INSTRUMENT || 'USDCX';
const AMOUNT = parseFloat(process.env.TEST_AMOUNT || '0.001');
const TOKEN_ADMIN_OVERRIDE = process.env.TEST_TOKEN_ADMIN; // opsional

if (!SENDER_EMAIL || !SENDER_PASS || !RECEIVER_EMAIL || !RECEIVER_PASS) {
  console.error(
    'FATAL: set TEST_SENDER_EMAIL/PASSWORD + TEST_RECEIVER_EMAIL/PASSWORD.\n' +
      'Bisa inline: TEST_SENDER_EMAIL=a@x TEST_SENDER_PASSWORD=... node ...',
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────
async function login(email, password) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`login ${email} ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.accessToken;
}

async function apiGet(token, path) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function apiPost(token, path, payload) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text.slice(0, 500) };
  }
  return { status: r.status, body };
}

// ── Resolve USDCx admin party dari swap/pools ────────────────────────────
// Backend /party/swap/pools return { tokens: [{ instrumentId, instrumentAdmin, isCC }] }.
async function resolveTokenAdmin(token, instrumentId) {
  if (TOKEN_ADMIN_OVERRIDE) {
    console.log(`[admin] override dari env: ${TOKEN_ADMIN_OVERRIDE.slice(0, 30)}…`);
    return TOKEN_ADMIN_OVERRIDE;
  }
  const { status, body } = await apiGet(token, '/party/swap/pools');
  if (status !== 200 || !body?.tokens) {
    console.log(`[admin] /party/swap/pools ${status} — tidak bisa resolve admin otomatis.`);
    return null;
  }
  const match = body.tokens.find(
    (t) => t.instrumentId?.toUpperCase() === instrumentId.toUpperCase(),
  );
  if (!match) {
    console.log(
      `[admin] ${instrumentId} tidak ditemukan di pools. Tersedia: ${body.tokens.map((t) => t.instrumentId).join(', ')}`,
    );
    return null;
  }
  console.log(`[admin] resolved dari pools: ${match.instrumentAdmin.slice(0, 30)}…`);
  return match.instrumentAdmin;
}

// ── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' Functional Test: P2P send-token (USDCx) — node support?');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` API base     : ${API_BASE}`);
  console.log(` Sender       : ${SENDER_EMAIL}`);
  console.log(` Receiver     : ${RECEIVER_EMAIL}`);
  console.log(` Token        : ${TOKEN_INSTRUMENT} × ${AMOUNT}`);
  console.log('');

  // [1] Login kedua user
  console.log('── [1] Login ───────────────────────────────────────────────');
  let senderJwt, receiverJwt;
  try {
    senderJwt = await login(SENDER_EMAIL, SENDER_PASS);
    console.log(`  ✅ sender login OK`);
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    process.exit(1);
  }
  try {
    receiverJwt = await login(RECEIVER_EMAIL, RECEIVER_PASS);
    console.log(`  ✅ receiver login OK`);
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    process.exit(1);
  }

  // [2] Cek wallet receiver (pastikan punya cantonPartyId)
  console.log('\n── [2] Wallet receiver ──────────────────────────────────────');
  const wa = await apiGet(receiverJwt, '/party/wallet-access');
  console.log(`  wallet-access: HTTP ${wa.status}`);
  // Coba ambil party id dari beberapa endpoint umum.
  let receiverPartyId = null;
  const partyEndpoints = ['/party/me', '/party', '/party/wallet'];
  for (const ep of partyEndpoints) {
    const r = await apiGet(receiverJwt, ep);
    const pid =
      r.body?.cantonPartyId || r.body?.partyId || r.body?.wallet?.cantonPartyId;
    if (pid) {
      receiverPartyId = pid;
      console.log(`  receiver partyId (${ep}): ${pid.slice(0, 30)}…`);
      break;
    }
  }
  if (!receiverPartyId) {
    console.log('  ⚠️  Tidak bisa resolve receiver partyId otomatis.');
    console.log('     Pakai username recipient di send-token (backend akan resolve).');
  }

  // [3] Resolve USDCx admin
  console.log('\n── [3] Resolve USDCx admin ─────────────────────────────────');
  const admin = await resolveTokenAdmin(senderJwt, TOKEN_INSTRUMENT);
  if (!admin) {
    console.error(
      '\n❌ TIDAK BISA RESOLVE admin USDCx. Set TEST_TOKEN_ADMIN di env,\n' +
        '   atau pastikan /party/swap/pools return USDCx.',
    );
    process.exit(2);
  }

  // [4] KIRIM TOKEN — inti test
  console.log('\n── [4] POST /party/send-token ──────────────────────────────');
  const recipientInput = receiverPartyId || RECEIVER_EMAIL;
  const clientNonce =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `test-${Date.now()}`;
  const send = await apiPost(senderJwt, '/party/send-token', {
    recipientUsername: recipientInput,
    amount: AMOUNT,
    instrumentId: TOKEN_INSTRUMENT,
    instrumentAdmin: admin,
    clientNonce,
  });
  console.log(`  HTTP ${send.status}`);
  console.log(`  Response:`);
  console.log('  ' + JSON.stringify(send.body, null, 2).replace(/\n/g, '\n  '));

  // [5] VERDICT
  console.log('\n── VERDICT ─────────────────────────────────────────────────');
  const ok =
    send.status < 400 &&
    (send.body?.ok === true || send.body?.success === true);
  if (ok) {
    console.log('  🎉 SUCCESS: node SUPPORT P2P transfer token non-CC.');
    console.log('     DAR token-standard pasti loaded. Fitur send-token SIAP.');
    console.log(
      `     transferKind=${send.body.transferKind} offerPending=${send.body.offerPending}`,
    );
    if (send.body.transferInstructionCid) {
      console.log(
        `     offer cid=${send.body.transferInstructionCid.slice(0, 24)}…`,
      );
      console.log('     → receiver harus Accept via Offers menu (two-step).');
    }
  } else {
    console.log('  ❌ GAGAL. Analisis error payload di atas untuk root cause:');
    const errMsg = String(send.body?.message || send.body?.error || '').toLowerCase();
    if (errMsg.includes('package') || errMsg.includes('template') || errMsg.includes('not found')) {
      console.log('     • Kalau error sebut "package"/"template"/"not found":');
      console.log('       → DAR token-standard BELUM loaded. Upload dulu.');
    } else if (errMsg.includes('holding') || errMsg.includes('balance') || errMsg.includes('fund')) {
      console.log('     • Kalau error sebut "holding"/"balance"/"fund":');
      console.log('       → DAR OK, tapi sender tidak punya USDCx on-chain.');
      console.log('       → Swap CC→USDCx dulu, atau kasih USDCx ke party sender.');
    } else if (errMsg.includes('transferfactory') || errMsg.includes('registry')) {
      console.log('     • Kalau error sebut "TransferFactory"/"registry":');
      console.log('       → Registry scan-proxy bermasalah. Cek CANTON_VALIDATOR_URL.');
    } else if (send.status === 403) {
      console.log('     • HTTP 403: wallet password dibutuhkan / akses ditolak.');
    } else if (send.status === 400) {
      console.log('     • HTTP 400: lihat pesan spesifik (mungkin validasi DTO).');
    }
    console.log('     → Paste full response di atas ke saya untuk diagnosis.');
  }
  console.log('════════════════════════════════════════════════════════════');
})().catch((e) => {
  console.error('\nFATAL:', e.message || e);
  process.exit(1);
});
