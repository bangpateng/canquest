// scripts/check-usdcx-credential.cjs
//
// Cek 3 prasyarat USDCx transfer di party user:
//   1. CREDENTIAL (holderRequirements) — apakah party pegang credential valid
//      dari registrar USDCx? Tanpa ini, transfer DITOLAK di validation layer.
//   2. HOLDING — apakah party pegang USDCx on-chain (saldo > 0)?
//   3. PREAPPROVAL — apakah sudah ada TransferPreapproval (1-step auto-accept)?
//
// Script ini READ-ONLY. Tidak submit command apa pun.
//
// Cara jalan (VPS):
//   cd /var/www/canquest/apps/api
//   node scripts/check-usdcx-credential.cjs
//
// Atau dengan party spesifik:
//   CHECK_PARTY=canquest-validator-1::1220... node scripts/check-usdcx-credential.cjs
//
// Env (dari .env):
//   LEDGER_API_URL / CANTON_JSON_API_URL
//   KEYCLOAK_URL, KEYCLOAK_REALM (default canton)
//   LEDGER_CLIENT_ID (default validator-app-backend), LEDGER_CLIENT_SECRET
//   CHECK_PARTY (opsional — kalau kosong, pakai CANTON_VALIDATOR_PARTY_ID)
//   USDCX_ADMIN (opsional — kalau kosong, auto-detect dari contracts)

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

const LEDGER_URL = (
  process.env.LEDGER_API_URL ||
  process.env.CANTON_JSON_API_URL ||
  'http://127.0.0.1:7575'
).replace(/\/$/, '');
const KC_URL = process.env.KEYCLOAK_URL;
const KC_REALM = process.env.KEYCLOAK_REALM || 'canton';
const CLIENT_ID = process.env.LEDGER_CLIENT_ID || 'validator-app-backend';
const CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET;
const SCOPE = 'daml_ledger_api';
const PARTY =
  process.env.CHECK_PARTY ||
  process.env.CANTON_VALIDATOR_PARTY_ID ||
  process.env.CANTON_APP_PROVIDER_PARTY_ID;
const USDCX_ADMIN_OVERRIDE = process.env.USDCX_ADMIN;

if (!KC_URL || !CLIENT_SECRET) {
  console.error('FATAL: KEYCLOAK_URL / LEDGER_CLIENT_SECRET belum set di .env.');
  process.exit(1);
}
if (!PARTY) {
  console.error(
    'FATAL: CHECK_PARTY atau CANTON_VALIDATOR_PARTY_ID belum set.\n' +
      'Contoh: CHECK_PARTY=verify::1220... node scripts/check-usdcx-credential.cjs',
  );
  process.exit(1);
}

// ── Template IDs yang dicari (dari DAR Utility yang sudah loaded) ────────
// Credential templates (utility-credential-v0 + utility-registry-app-v0):
const CREDENTIAL_KEYWORDS = [
  'Credential', // generic match — akan difilter lebih spesifik di bawah
  'HolderCredential',
  'utility-credential',
  'utility-registry-app',
];
// Holding template (token-standard):
const HOLDING_KEYWORDS = ['Holding', 'TransferInstruction', 'TransferFactory'];
// Preapproval template (registry-app):
const PREAPPROVAL_KEYWORD = 'TransferPreapproval';

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

async function queryAcs(t, party, offset) {
  const r = await fetch(`${LEDGER_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [party]: {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              },
            ],
          },
        },
        verbose: true,
      },
      activeAtOffset: offset,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`acs ${r.status}: ${txt.slice(0, 300)}`);
  }
  const arr = await r.json();
  return Array.isArray(arr) ? arr : [];
}

const createdEvent = (entry) => {
  const wrapper = entry?.contractEntry;
  return (
    wrapper?.JsActiveContract?.createdEvent || entry?.createdEvent || entry
  );
};

// ── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' Cek USDCx Prasyarat: Credential + Holding + Preapproval');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Ledger URL  : ${LEDGER_URL}`);
  console.log(` Party       : ${PARTY.slice(0, 40)}…`);
  console.log(` USDCx admin : ${USDCX_ADMIN_OVERRIDE ? USDCX_ADMIN_OVERRIDE.slice(0, 30) + '… (override)' : '(auto-detect)'}`);
  console.log('');

  const t = await fetchToken();
  const live = await fetch(`${LEDGER_URL}/livez`).then((r) => r.ok).catch(() => false);
  console.log(`[${live ? 'OK' : 'FAIL'}] Ledger livez`);
  if (!live) {
    console.error('  Ledger tidak reachable. Cek tunnel / LEDGER_API_URL.');
    process.exit(1);
  }

  const offset = await ledgerEnd(t);
  console.log(`[OK] Ledger offset: ${offset}`);

  // Query SEMUA contracts milik party.
  console.log('\n── Query ACS party ─────────────────────────────────────────');
  let contracts = [];
  try {
    contracts = await queryAcs(t, PARTY, offset);
    console.log(`  Total contracts visible: ${contracts.length}`);
  } catch (err) {
    console.error(`  ❌ ACS query gagal: ${err.message}`);
    console.error('  Kemungkinan: party tidak visible ke token client, atau');
    console.error('  party salah. Cek CHECK_PARTY / CANTON_VALIDATOR_PARTY_ID.');
    process.exit(1);
  }

  // Klasifikasi contracts.
  const credentials = [];
  const holdings = [];
  const preapprovals = [];
  const transferInstructions = [];
  const otherTemplates = new Map(); // templateId → count

  for (const entry of contracts) {
    const ev = createdEvent(entry);
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    const cid = typeof ev.contractId === 'string' ? ev.contractId : '';
    const args = ev.createArgument || {};

    if (!tplId) continue;

    // Categorize.
    if (
      CREDENTIAL_KEYWORDS.some((k) => tplId.toLowerCase().includes(k.toLowerCase()))
    ) {
      credentials.push({ tplId, cid, args });
    } else if (tplId.includes('TransferPreapproval')) {
      preapprovals.push({ tplId, cid, args });
    } else if (tplId.includes('TransferInstruction')) {
      transferInstructions.push({ tplId, cid, args });
    } else if (tplId.includes('Holding')) {
      holdings.push({ tplId, cid, args });
    } else {
      otherTemplates.set(tplId, (otherTemplates.get(tplId) ?? 0) + 1);
    }
  }

  // ── [1] CREDENTIAL ─────────────────────────────────────────────────────
  console.log('\n── [1] CREDENTIAL (holderRequirements) ────────────────────');
  if (credentials.length === 0) {
    console.log('  ℹ️  TIDAK ADA contract dengan template mengandung "Credential".');
    console.log('     PERHATIAN: bisa false negative. Lihat "Template lain" di');
    console.log('     bawah — credential mungkin punya nama template yang tidak');
    console.log('     literal "Credential" (mis. HolderCredential, WalletCredential).');
    console.log('     Kalau USDCx holding ADA + transfer mendarat, kemungkinan');
    console.log('     credential sebenarnya OK (tidak blocker).');
  } else {
    console.log(`  ✅ DITEMUKAN ${credentials.length} credential contract(s):`);
    for (const c of credentials.slice(0, 10)) {
      const admin =
        c.args.instrumentAdmin ?? c.args.registrar ?? '(no admin field)';
      const instIdRaw = c.args.instrumentId ?? '';
      const instStr =
        typeof instIdRaw === 'string' ? instIdRaw : (instIdRaw && instIdRaw.id) ?? '';
      console.log(`     • FULL templateId: ${c.tplId}`);
      console.log(
        `       cid=${c.cid.slice(0, 24)}… admin=${String(admin).slice(0, 30)}… inst=${instStr || '(none)'}`,
      );
    }
  }

  // ── [2] HOLDING (saldo USDCx on-chain) ────────────────────────────────
  console.log('\n── [2] HOLDING (saldo token on-chain) ─────────────────────');
  // Filter holding yang BUKAN Amulet (CC) — kita cari token non-CC.
  const nonCcHoldings = holdings.filter(
    (h) => !h.tplId.toLowerCase().includes('amulet'),
  );
  if (holdings.length === 0) {
    console.log('  ℹ️  TIDAK ADA holding contract (termasuk CC).');
    console.log('     Party ini belum pegang token apa pun on-chain.');
  } else if (nonCcHoldings.length === 0) {
    console.log(
      `  ℹ️  Ada ${holdings.length} holding(s), tapi SEMUA CC (Amulet).`,
    );
    console.log('     Party belum pegang USDCx on-chain.');
    console.log('     Untuk test P2P USDCx: swap CC→USDCx dulu, atau');
    console.log('     transfer USDCx dari party lain.');
  } else {
    console.log(
      `  ✅ DITEMUKAN ${nonCcHoldings.length} non-CC holding(s):`,
    );
    for (const h of nonCcHoldings.slice(0, 10)) {
      const amount = h.args.amount ?? '?';
      const inst = h.args.instrument;
      const instId = inst && typeof inst === 'object' ? inst.id : '?';
      console.log(
        `     • ${instId}: amount=${amount} (tpl=${h.tplId.slice(0, 40)}…)`,
      );
    }
  }

  // ── [3] PREAPPROVAL (1-step auto-accept) ──────────────────────────────
  console.log('\n── [3] PREAPPROVAL (1-step auto-accept) ───────────────────');
  if (preapprovals.length === 0) {
    console.log('  ℹ️  TIDAK ADA preapproval contract.');
    console.log('     Transfer akan jalan 2-step (offer → accept manual).');
    console.log('     Untuk 1-step (auto-accept), bangun preapproval (Tahap 3).');
  } else {
    console.log(
      `  ✅ DITEMUKAN ${preapprovals.length} preapproval contract(s):`,
    );
    for (const p of preapprovals.slice(0, 5)) {
      console.log(`     • FULL templateId: ${p.tplId}`);
      console.log(`       cid=${p.cid.slice(0, 24)}…`);
      console.log(`       args=${JSON.stringify(p.args).slice(0, 200)}`);
    }
  }

  // ── Pending TransferInstructions (incoming offers) ───────────────────
  console.log(
    `\n── PENDING TransferInstructions: ${transferInstructions.length} ─`,
  );
  if (transferInstructions.length === 0) {
    console.log('  (tidak ada offer masuk yang pending)');
  } else {
    console.log('  (offer masuk yang belum di-accept/reject)');
    for (const ti of transferInstructions.slice(0, 5)) {
      const transfer = ti.args.transfer || {};
      const sender = transfer.sender || '(unknown)';
      const amount = transfer.amount || '?';
      const inst = transfer.instrumentId || {};
      const instId = typeof inst === 'object' ? inst.id : inst;
      console.log(`     • FULL templateId: ${ti.tplId}`);
      console.log(`       cid=${ti.cid.slice(0, 24)}…`);
      console.log(
        `       sender=${String(sender).slice(0, 30)}… amount=${amount} inst=${instId || '?'}`,
      );
    }
  }

  // ── Semua template lain (debug) ───────────────────────────────────────
  if (otherTemplates.size > 0) {
    console.log(
      `\n── Template lain di ACS (${otherTemplates.size} jenis) ──────`,
    );
    for (const [tpl, count] of [...otherTemplates.entries()]) {
      console.log(`     ${count}× ${tpl}`);
    }
  }

  // ── VERDICT ───────────────────────────────────────────────────────────
  console.log('\n── VERDICT ───────────────────────────────────────────────');
  const hasCredential = credentials.length > 0;
  const hasNonCcHolding = nonCcHoldings.length > 0;
  const hasPendingInstruction = transferInstructions.length > 0;
  if (hasNonCcHolding) {
    console.log('  ✅ USDCx HOLDING ADA on-chain (saldo > 0).');
    console.log('     Bukti kuat: transfer USDCx ke party ini SUDAH BERHASIL');
    console.log('     mendarat. Credential requirement kemungkinan terpenuhi');
    console.log('     (walau nama template tidak literal "Credential").');
    if (hasPendingInstruction) {
      console.log('  ✅ Ada pending TransferInstruction (offer masuk).');
      console.log('     → Coba ACCEPT via endpoint /party/offers/accept yang sudah');
      console.log('       ada. Kalau sukses → 2-step USDCx jalan.');
    }
    console.log('  → LANJUT Tahap 2: test P2P 2-step.');
  } else if (hasCredential && !hasNonCcHolding) {
    console.log('  ⚠️  Credential OK, tapi USDCx holding belum ada.');
    console.log('     → Swap CC→USDCx dulu, atau transfer USDCx dari party lain.');
  } else {
    console.log('  ℹ️  Credential tidak terdeteksi (kemungkinan false negative).');
    console.log('     Tidak ada USDCx holding → belum bisa konfirmasi transfer jalan.');
    console.log('     Cek "Template lain" di atas — cari yang mengandung "Holder",');
    console.log('     "Wallet", "Registry.App", dll. Itu kandidat credential sebenarnya.');
  }
  console.log('════════════════════════════════════════════════════════════');
})().catch((e) => {
  console.error('\nFATAL:', e.message || e);
  process.exit(1);
});
