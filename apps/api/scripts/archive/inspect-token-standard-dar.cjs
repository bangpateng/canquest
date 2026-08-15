// scripts/inspect-token-standard-dar.cjs
//
// Inspeksi READ-ONLY: verifikasi apakah validator/participant node sudah punya
// splice-util-token-standard-wallet DAR ter-load, dan apakah kontrak token-standard
// (TransferFactory, TransferInstruction, MergeDelegationProposal, BatchMergeUtility)
// tersedia untuk dipakai fitur P2P token transfer (USDCx, dll).
//
// MENJAWAB PERTANYAAN KRITIS:
//   "Apakah fitur send-token (yang sudah saya bangun) bisa dipakai SEKARANG?"
//
// NON-DESTRUCTIVE: hanya query, tidak submit command apa pun.
//
// Referensi resmi:
//   - https://docs.global.canton.network.sync.global/app_dev/token_standard/index.html
//   - https://docs.sync.global/app_dev/api/splice-util-token-standard-wallet/Splice-Util-Token-Wallet-MergeDelegation.html
//
// Cara jalan (VPS):
//   cd /var/www/canquest/apps/api && node scripts/inspect-token-standard-dar.cjs
//
// Env yang dibutuhkan (dari .env):
//   LEDGER_API_URL / CANTON_JSON_API_URL (default http://127.0.0.1:7575)
//   KEYCLOAK_URL, KEYCLOAK_REALM (default canton)
//   LEDGER_CLIENT_ID (default validator-app-backend), LEDGER_CLIENT_SECRET
//   CANTON_DSO_PARTY_ID (opsional — untuk cek MergeDelegation aktif)
//   CANTON_VALIDATOR_PARTY_ID (opsional — wallet provider party)

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
} catch (e) {
  console.warn('[env] dotenv tidak tersedia, pakai process.env saja.');
}

const LEDGER_URL =
  process.env.LEDGER_API_URL ||
  process.env.CANTON_JSON_API_URL ||
  'http://127.0.0.1:7575';
const KC_URL = process.env.KEYCLOAK_URL;
const KC_REALM = process.env.KEYCLOAK_REALM || 'canton';
const CLIENT_ID = process.env.LEDGER_CLIENT_ID || 'validator-app-backend';
const CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET;
const SCOPE = 'daml_ledger_api';
const DSO_PARTY = process.env.CANTON_DSO_PARTY_ID;
const WALLET_PROVIDER_PARTY =
  process.env.CANTON_VALIDATOR_PARTY_ID ||
  process.env.CANTON_APP_PROVIDER_PARTY_ID;

// ── Kontrak yang dicari (dari splice-util-token-standard-wallet DAR) ─────
// Nama-nama ini muncul di templateId contract di ACS, atau di package list.
const REQUIRED_CONTRACTS = [
  // Core transfer (CIP-0056) — wajib untuk send-token bisa jalan.
  'TransferFactory',
  'TransferInstruction',
  'AllocationRequest',
  // Wallet-side merge infra — opsional (optimasi UTXO).
  'MergeDelegationProposal',
  'MergeDelegation',
  'BatchMergeUtility',
];

// Substring nama package DAR yang dicari di list packages.
const TARGET_DAR_KEYWORDS = [
  'token-standard-wallet',
  'token-standard',
  'splice-util-token',
];

if (!KC_URL || !CLIENT_SECRET) {
  console.error(
    'FATAL: KEYCLOAK_URL / LEDGER_CLIENT_SECRET belum set. Isi di .env.',
  );
  process.exit(1);
}

async function fetchToken() {
  const r = await fetch(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPE,
      }),
    },
  );
  if (!r.ok) {
    throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return (await r.json()).access_token;
}

// ── [1] Package list: DAR mana saja yang ter-load? ───────────────────────
// JSON Ledger API: POST /v2/state/package-list (atau /v2/packages di versi lama).
async function getPackageList(t) {
  const candidates = ['/v2/state/package-list', '/v2/packages'];
  for (const ep of candidates) {
    try {
      const r = await fetch(`${LEDGER_URL}${ep}`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        const body = await r.json();
        // Shape bisa { packageId: { ... } } atau [ { packageId, ... } ].
        return normalizePackages(body, ep);
      }
    } catch {
      /* coba endpoint berikut */
    }
  }
  return null; // endpoint tidak ada
}

function normalizePackages(body, ep) {
  const out = [];
  if (Array.isArray(body)) {
    for (const p of body) {
      out.push({
        packageId: p.packageId || p.id || p,
        name: p.name || p.packageName || '',
        source: ep,
      });
    }
  } else if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      out.push({
        packageId: k,
        name: (v && (v.name || v.packageName)) || '',
        source: ep,
      });
    }
  }
  return out;
}

// ── [2] Cek livez ledger ─────────────────────────────────────────────────
async function checkLive(t) {
  try {
    const r = await fetch(`${LEDGER_URL}/livez`, {
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── [3] Cek MergeDelegation aktif untuk wallet provider party (opsional) ─
async function findMergeDelegationContracts(t, offset) {
  const parties = [WALLET_PROVIDER_PARTY, DSO_PARTY].filter(Boolean);
  if (parties.length === 0) return { checked: false, found: [] };

  const filtersByParty = {};
  for (const p of parties) {
    filtersByParty[p] = {
      cumulative: [
        {
          identifierFilter: {
            WildcardFilter: { value: { includeCreatedEventBlob: false } },
          },
        },
      ],
    };
  }
  try {
    const r = await fetch(`${LEDGER_URL}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventFormat: { filtersByParty, verbose: true },
        activeAtOffset: offset,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { checked: true, found: [], error: `acs ${r.status}` };
    const arr = await r.json();
    const list = Array.isArray(arr) ? arr : [];
    const found = [];
    for (const entry of list) {
      const ev =
        entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry ?? {};
      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (
        tplId.includes('MergeDelegation') ||
        tplId.includes('BatchMergeUtility')
      ) {
        found.push({
          templateId: tplId,
          contractId: ev.contractId?.slice(0, 24),
        });
      }
    }
    return { checked: true, found };
  } catch (err) {
    return { checked: true, found: [], error: String(err) };
  }
}

async function ledgerEnd(t) {
  try {
    const r = await fetch(`${LEDGER_URL}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!r.ok) return 0;
    return (await r.json()).offset ?? 0;
  } catch {
    return 0;
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' Inspeksi Token-Standard DAR & MergeDelegation readiness');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Ledger URL       : ${LEDGER_URL}`);
  console.log(` Keycloak         : ${KC_URL}/realms/${KC_REALM}`);
  console.log(` Client ID        : ${CLIENT_ID}`);
  console.log(
    ` DSO party        : ${DSO_PARTY ? DSO_PARTY.slice(0, 30) + '…' : '(tidak set)'}`,
  );
  console.log(
    ` Wallet provider  : ${WALLET_PROVIDER_PARTY ? WALLET_PROVIDER_PARTY.slice(0, 30) + '…' : '(tidak set)'}`,
  );
  console.log('');

  // [1] Live check
  const t = await fetchToken();
  const live = await checkLive(t);
  console.log(`[${live ? 'OK' : 'FAIL'}] Ledger livez`);
  if (!live) {
    console.error('  Ledger tidak reachable. Cek SSH tunnel / CANTON_JSON_API_URL.');
    process.exit(1);
  }

  // [2] Package list — DAR ter-load?
  console.log('\n── Package list (DAR ter-load) ──────────────────────────────');
  const packages = await getPackageList(t);
  if (!packages) {
    console.log('  ⚠️  Endpoint package-list tidak tersedia di versi API ini.');
    console.log('     Lanjut ke cek kontrak via ACS (bisa tetap validasi).');
  } else {
    console.log(`  Total package ter-load: ${packages.length}`);
    const matching = packages.filter((p) =>
      TARGET_DAR_KEYWORDS.some((kw) =>
        (p.packageId + ' ' + p.name).toLowerCase().includes(kw),
      ),
    );
    if (matching.length === 0) {
      console.log('  ❌ TIDAK ada package token-standard ditemukan di list.');
      console.log('     → DAR belum ter-upload ke participant node.');
      console.log('     → Upload splice-util-token-standard-wallet.dar via');
      console.log('       validator API atau taruh di dars/ + restart node.');
    } else {
      console.log('  ✅ Package token-standard DITEMUKAN:');
      for (const p of matching) {
        console.log(`     • ${p.packageId}${p.name ? `  (${p.name})` : ''}`);
      }
    }
    // Dump semua package (verbose, untuk debugging).
    console.log('\n  ── Semua package (untuk referensi) ──');
    for (const p of packages.slice(0, 50)) {
      console.log(`     ${p.packageId}${p.name ? `  — ${p.name}` : ''}`);
    }
    if (packages.length > 50)
      console.log(`     … dan ${packages.length - 50} lainnya.`);
  }

  // [3] MergeDelegation aktif untuk wallet provider party?
  console.log('\n── MergeDelegation / BatchMergeUtility aktif? ──────────────');
  const offset = await ledgerEnd(t);
  const md = await findMergeDelegationContracts(t, offset);
  if (!md.checked) {
    console.log('  ⚠️  Tidak ada party wallet provider/DSO di env — skip cek.');
    console.log('     Set CANTON_VALIDATOR_PARTY_ID / CANTON_DSO_PARTY_ID utk cek.');
  } else if (md.error) {
    console.log(`  ⚠️  Cek ACS gagal: ${md.error}`);
  } else if (md.found.length === 0) {
    console.log('  ℹ️  Belum ada MergeDelegationProposal/Contract aktif.');
    console.log('     Ini NORMAL untuk node baru. MergeDelegation adalah');
    console.log('     OPTIMASI (UTXO consolidation), bukan blocker P2P transfer.');
    console.log('     P2P send-token tetap jalan tanpa ini — hanya UTXO bisa');
    console.log('     menumpuk seiring waktu (merge manual diperlukan nanti).');
  } else {
    console.log(`  ✅ Ditemukan ${md.found.length} kontrak merge aktif:`);
    for (const c of md.found) {
      console.log(`     • ${c.templateId}  (cid ${c.contractId}…)`);
    }
  }

  // [4] Verdict
  console.log('\n── VERDICT ─────────────────────────────────────────────────');
  const hasDar =
    packages && packages.length > 0
      ? TARGET_DAR_KEYWORDS.some((kw) =>
          packages.some((p) =>
            (p.packageId + ' ' + p.name).toLowerCase().includes(kw),
          ),
        )
      : null; // unknown (endpoint tidak ada)
  if (hasDar === true) {
    console.log('  ✅ Token-standard DAR TER-LOAD. Fitur send-token SIAP DIPAKAI.');
    if (md.checked && md.found.length === 0) {
      console.log('  ℹ️  MergeDelegation belum di-setup (opsional, optimasi saja).');
    }
  } else if (hasDar === false) {
    console.log('  ❌ Token-standard DAR BELUM ter-load.');
    console.log('     ACTION: upload splice-util-token-standard-wallet.dar ke');
    console.log('     participant node sebelum fitur send-token bisa dipakai.');
  } else {
    console.log('  ❓ Status DAR tidak bisa diverifikasi via package-list.');
    console.log('     Lakong test fungsional: coba kirim USDCx kecil via API.');
  }
  console.log('════════════════════════════════════════════════════════════');
})().catch((e) => {
  console.error('\nFATAL:', e.message || e);
  process.exit(1);
});
