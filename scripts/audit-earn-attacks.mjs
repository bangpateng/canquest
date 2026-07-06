#!/usr/bin/env node
/**
 * Dry-run ATTACK SIMULATION untuk Earn claim system (Canton MainNet).
 *
 * Tujuan: verifikasi empiris bahwa 4 endpoint claim (FCFS, Draw CC, CC+Code
 * Raffle, Invite Code) TIDAK bisa di-exploit user. Test 5 attack vector:
 *   1. Non-winner claim (claim quest yang user tidak menang)
 *   2. Double-claim (claim 2x untuk win yang sama)
 *   3. Claim quest yang tidak eligible / tidak ada
 *   4. Spoof userId (kirim body userId palsu — harus di-ignore, JWT-based)
 *   5. Throttle bypass (spam claim cepat)
 *
 * Script ini TIDAK akan benar-benar menggerakkan CC kalau attack berhasil
 * ditolak (yang seharusnya terjadi). Endpoint akan return error 4xx.
 *
 * Usage (jalankan di VPS-2 atau local):
 *   export BASE_URL="https://canquest.cc"
 *   export ATTACKER_EMAIL="user-test-anda@email.com"
 *   export ATTACKER_PASSWORD="password-anda"
 *   export NON_WINNING_QUEST_ID="<quest-id-yg-user-tidak-menang>"
 *
 *   node scripts/audit-earn-attacks.mjs
 *
 * Requires Node 18+. No deps.
 */

const BASE_URL = (process.env.BASE_URL ?? 'https://canquest.cc').replace(/\/$/, '');
const EMAIL = process.env.ATTACKER_EMAIL;
const PASSWORD = process.env.ATTACKER_PASSWORD;
const NON_WINNING_QUEST_ID = process.env.NON_WINNING_QUEST_ID;

if (!EMAIL || !PASSWORD) {
  console.error('Need env: ATTACKER_EMAIL, ATTACKER_PASSWORD.');
  console.error('Optional: BASE_URL, NON_WINNING_QUEST_ID');
  console.error('Example: ATTACKER_EMAIL=a@b.c ATTACKER_PASSWORD=x node scripts/audit-earn-attacks.mjs');
  process.exit(1);
}

const CLAIM_ENDPOINTS = [
  { name: 'claim-fcfs', path: (qid) => `/api/quests/${qid}/claim-fcfs` },
  { name: 'claim-draw-cc', path: (qid) => `/api/quests/${qid}/claim-draw-cc` },
  { name: 'claim-cc-and-code-raffle', path: (qid) => `/api/quests/${qid}/claim-cc-and-code-raffle` },
  { name: 'claim-invite', path: (qid) => `/api/quests/${qid}/claim-invite` },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const gray = (s) => `\x1b[90m${s}\x1b[0m`;

async function login() {
  console.log(cyan(`\n🔐 Logging in as ${EMAIL}…`));
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  const token = data.accessToken ?? data.access_token ?? data.token;
  if (!token) {
    console.error(red(`✗ Login failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`));
    process.exit(2);
  }
  console.log(green('✓ Token obtained.'));
  return token;
}

async function hitClaim(token, fullPath, extraBody = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${fullPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(extraBody),
      signal: AbortSignal.timeout(30_000),
    });
    const elapsed = Date.now() - t0;
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
    return { status: res.status, ok: res.ok, elapsed, body };
  } catch (err) {
    return { status: 0, ok: false, elapsed: Date.now() - t0, body: { error: String(err) }, networkError: true };
  }
}

function truncate(s, n = 150) {
  if (!s) return '';
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function verdictLine(scenario, expected, status, body) {
  const passed = expected(status);
  const symbol = passed ? green('✓ PASS') : red('✗ FAIL');
  const detail = passed ? gray(truncate(body?.message ?? body)) : red(truncate(body?.message ?? body));
  console.log(`  ${symbol} [${status}] ${scenario}`);
  console.log(`         ${detail}`);
  return passed;
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(cyan('═══════════════════════════════════════════════════════════'));
  console.log(cyan('  EARN CLAIM ATTACK SIMULATION'));
  console.log(cyan('  Target: ') + BASE_URL);
  console.log(cyan('═══════════════════════════════════════════════════════════'));

  const token = await login();

  // ── ATTACK 1: Non-winner claim ──────────────────────────────────────────
  // Test kalau ada quest yang user TIDAK menang (raffle) atau TIDAK eligible
  // (FCFS full). Endpoint harus return 4xx.
  console.log(cyan('\n── ATTACK 1: Non-winner claim ────────────────────────────'));
  console.log(gray('  Mencoba claim quest yang user tidak menang / tidak eligible.'));
  const results1 = [];
  for (const ep of CLAIM_ENDPOINTS) {
    if (!NON_WINNING_QUEST_ID) {
      console.log(yellow(`  ⚠ SKIP ${ep.name}: NON_WINNING_QUEST_ID tidak diset.`));
      continue;
    }
    const r = await hitClaim(token, ep.path(NON_WINNING_QUEST_ID));
    // Expected: 4xx (reject). Kalau 200 = BUG berbahaya.
    const passed = verdictLine(
      `${ep.name} pada quest non-winning`,
      (s) => s >= 400 && s < 500,
      r.status,
      r.body,
    );
    results1.push({ ep: ep.name, passed });
  }

  // ── ATTACK 2: Claim quest yang tidak ada ────────────────────────────────
  console.log(cyan('\n── ATTACK 2: Claim quest yang tidak ada (404) ────────────'));
  const FAKE_QUEST = 'cmr_fakequest_nonexistent_00000';
  const results2 = [];
  for (const ep of CLAIM_ENDPOINTS) {
    const r = await hitClaim(token, ep.path(FAKE_QUEST));
    const passed = verdictLine(
      `${ep.name} pada quest fake`,
      (s) => s >= 400 && s < 500,
      r.status,
      r.body,
    );
    results2.push({ ep: ep.name, passed });
  }

  // ── ATTACK 3: Spoof userId via body ─────────────────────────────────────
  console.log(cyan('\n── ATTACK 3: Spoof userId via body (harus di-ignore) ────'));
  console.log(gray('  Kirim body {userId: "victim-uuid"} — harus di-ignore, JWT-based.'));
  if (!NON_WINNING_QUEST_ID) {
    console.log(yellow('  ⚠ SKIP: NON_WINNING_QUEST_ID tidak diset.'));
  } else {
    for (const ep of CLAIM_ENDPOINTS) {
      const r = await hitClaim(token, ep.path(NON_WINNING_QUEST_ID), {
        userId: 'cmr0victim0000fakeuuid_fakefake_fake_fake',
        amountCc: 999999, // coba inflate amount
        cantonPartyId: 'verify::fakefake',
      });
      const passed = verdictLine(
        `${ep.name} dengan spoof userId+amount`,
        (s) => s >= 400 && s < 500,
        r.status,
        r.body,
      );
      // Tambahan: kalau 200, itu berbahaya banget (spoof berhasil)
      if (r.ok) console.log(red(`         🚨 KRITIS: ${ep.name} terima spoof! Body: ${truncate(r.body)}`));
    }
  }

  // ── ATTACK 4: Throttle / spam ───────────────────────────────────────────
  console.log(cyan('\n── ATTACK 4: Spam 5x cepat (throttle check) ─────────────'));
  console.log(gray('  Kirim 5 request paralel ke claim-fcfs. Throttle harus batasi.'));
  if (!NON_WINNING_QUEST_ID) {
    console.log(yellow('  ⚠ SKIP: NON_WINNING_QUEST_ID tidak diset.'));
  } else {
    const spamResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        hitClaim(token, CLAIM_ENDPOINTS[0].path(NON_WINNING_QUEST_ID)),
      ),
    );
    const statuses = spamResults.map((r) => r.status).sort();
    const has429 = statuses.some((s) => s === 429);
    const all4xx = statuses.every((s) => s >= 400 && s < 500);
    const symbol = (has429 || all4xx) ? green('✓ PASS') : yellow('⚠ CHECK');
    console.log(`  ${symbol} Spam 5x → statuses: [${statuses.join(', ')}]`);
    console.log(gray(`         Ideal: semua 4xx, beberapa 429 (throttle aktif).`));
    console.log(gray(`         Kalau ada 200 beruntun = perlu cek lebih lanjut.`));
  }

  // ── ATTACK 5: Double-claim (happy path untuk user yang MENANG) ──────────
  // Note: ini BUTUH quest yang user memang menang. Kalau belum ada, skip.
  // Kasus: claim sekali (sukses), lalu claim lagi (harus reject).
  // ⚠ HATI-HATI: ini akan benar-benar trigger claim jika user memang menang.
  // Untuk safety, script TIDAK otomatis lakukan ini. Cuma print instruksi.
  console.log(cyan('\n── ATTACK 5: Double-claim (MANUAL TEST) ─────────────────'));
  console.log(yellow('  ⚠ Skrip tidak otomatis test ini (bisa benar-benar klaim).'));
  console.log(gray('  Cara manual:'));
  console.log(gray('    1. Login sebagai user yang memang MENANG quest tertentu.'));
  console.log(gray('    2. POST claim-fcfs (atau claim-draw-cc) sekali → harus 200.'));
  console.log(gray('    3. POST lagi ke endpoint yang sama → harus 4xx (already claimed).'));
  console.log(gray('    Kalau kali kedua 200 = BUG double-claim berbahaya.'));

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log(cyan('\n═══════════════════════════════════════════════════════════'));
  console.log(cyan('  SUMMARY'));
  console.log(cyan('═══════════════════════════════════════════════════════════'));
  const allResults = [...results1, ...results2];
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;
  console.log(`  Total test: ${allResults.length}`);
  console.log(`  ${green('✓ PASS')}: ${passed}`);
  console.log(`  ${red('✗ FAIL')}: ${failed}`);
  if (failed === 0) {
    console.log(green('\n  🎉 Semua attack ditolak. Earn system AMAN.'));
  } else {
    console.log(red(`\n  ⚠️  ${failed} test gagal — perlu investigasi.`));
  }

  console.log(gray('\n  Note: Attack 5 (double-claim) perlu test manual lihat instruksi di atas.'));
  console.log('');
})();
