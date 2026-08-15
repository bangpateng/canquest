// scripts/discover-token-templates.cjs
// Discovery: cari template DAML untuk holding token non-CC (USDCx dll)
// di trading account Cantex. BLOCKER untuk generalisasi transfer non-CC.
//
// Flow:
//   1. Auth Keycloak (LEDGER_CLIENT_ID/SECRET) untuk akses Canton Ledger API
//   2. Query ACS trading account party (Cantex::1220...) via WildcardFilter
//   3. Dump SEMUA contract: templateId, instrument fields, amount
//   4. Filter yang bukan Splice.Amulet → kandidat holding token non-CC
//
// Cara jalan (VPS):
//   cd /var/www/canquest/apps/api
//   node scripts/discover-token-templates.cjs
//
// Env (dari .env): LEDGER_API_URL, KEYCLOAK_URL, KEYCLOAK_REALM,
//   LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET, CANTEX_TRADING_ACCOUNT_PARTY

const path = require('path');
let loaded = null;
try {
  const dotenv = require('dotenv');
  for (const p of [path.resolve(__dirname, '../.env'), '/var/www/canquest/apps/api/.env']) {
    const r = dotenv.config({ path: p }); if (!r.error) { loaded = p; break; }
  }
} catch (e) { console.log('dotenv?', e.message); }
console.log('ENV dari:', loaded || '(none)');

if (typeof fetch !== 'function') {
  console.error('FATAL: no global fetch, Node', process.version); process.exit(1);
}

const LEDGER_URL = (process.env.LEDGER_API_URL || '').replace(/\/$/, '');
const KC_URL = process.env.KEYCLOAK_URL || '';
const KC_REALM = process.env.KEYCLOAK_REALM || 'canton';
const CLIENT_ID = process.env.LEDGER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET || '';
const SCOPE = process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api';
const TRADING_PARTY = process.env.CANTEX_TRADING_ACCOUNT_PARTY || '';

if (!LEDGER_URL || !KC_URL || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('FATAL: LEDGER_API_URL / KEYCLOAK_URL / LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET belum set.');
  process.exit(1);
}
if (!TRADING_PARTY) {
  console.error('FATAL: CANTEX_TRADING_ACCOUNT_PARTY belum set.');
  process.exit(1);
}

async function token() {
  const r = await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: SCOPE }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

async function ledgerEnd(t) {
  const r = await fetch(`${LEDGER_URL}/v2/state/ledger-end`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`ledger-end ${r.status}`);
  return (await r.json()).offset;
}

async function queryAcs(t, party, offset) {
  // WildcardFilter: dapatkan SEMUA contract milik party.
  // Keycloak admin token (validator-app-backend) punya actAs luas,
  // jadi bisa query party mana pun.
  const r = await fetch(`${LEDGER_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] },
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

/** Coba beberapa party untuk query ACS — trading party mungkin tidak punya
 *  visibility penuh. Admin/validator party biasanya bisa actAs. */
async function queryAcsMultiParty(t, parties, offset) {
  const filtersByParty = {};
  for (const p of parties) {
    filtersByParty[p] = { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] };
  }
  const r = await fetch(`${LEDGER_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventFormat: { filtersByParty, verbose: true },
      activeAtOffset: offset,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`acs multi ${r.status}: ${txt.slice(0, 300)}`);
  }
  const arr = await r.json();
  return Array.isArray(arr) ? arr : [];
}

const createdEvent = (entry) => {
  const wrapper = entry?.contractEntry;
  return wrapper?.JsActiveContract?.createdEvent || entry?.createdEvent || entry;
};

(async () => {
  console.log('\n=== DISCOVERY: template DAML holding token non-CC ===');
  console.log('Trading party:', TRADING_PARTY.slice(0, 40) + '...');
  console.log('Ledger:', LEDGER_URL);

  const t = await token();
  console.log('✓ Keycloak token OK');
  const offset = await ledgerEnd(t);
  console.log('✓ Ledger offset:', offset);

  console.log('\n--- Query ACS trading account (WildcardFilter) ---');
  let contracts = await queryAcs(t, TRADING_PARTY, offset);
  console.log('Total contracts (trading party only):', contracts.length);

  // Kalau trading party sedikit/misal gak ada holding non-CC, coba multi-party
  // (tambah validator/admin party yang punya read rights luas).
  const validatorParty = process.env.CANTON_VALIDATOR_PARTY_ID || '';
  if (contracts.length < 10 && validatorParty) {
    console.log('\n--- Retry dengan multi-party (trading + validator) ---');
    try {
      const multi = await queryAcsMultiParty(t, [TRADING_PARTY, validatorParty], offset);
      console.log('Total contracts (multi-party):', multi.length);
      if (multi.length > contracts.length) contracts = multi;
    } catch (err) {
      console.log('Multi-party query failed:', err.message);
    }
  }

  // Kelompokkan by templateId.
  const byTemplate = new Map();
  const nonAmulet = [];
  for (const entry of contracts) {
    const ev = createdEvent(entry);
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    if (!tplId) continue;
    const count = byTemplate.get(tplId) || 0;
    byTemplate.set(tplId, count + 1);
    // Non-Amulet contracts = kandidat holding token non-CC.
    if (!tplId.includes('Splice.Amulet:Amulet') && !tplId.includes('TransferInstruction') && !tplId.includes('TransferOffer') && !tplId.includes('TransferPreapproval')) {
      nonAmulet.push({ tplId, ev });
    }
  }

  console.log('\n--- Semua template ditemukan (count) ---');
  for (const [tpl, count] of [...byTemplate.entries()].sort()) {
    console.log(`  ${count}× ${tpl}`);
  }

  console.log(`\n--- Kandidat holding token non-CC (${nonAmulet.length} contracts, non-Amulet/Instruction/Preapproval) ---`);
  if (nonAmulet.length === 0) {
    console.log('  (tidak ada — semua contract Amulet/Instruction/Preapproval)');
    console.log('\n  ⚠ Trading account party mungkin tidak punya ACS visibility untuk holding non-CC.');
    console.log('    Ini bisa karena party `Cantex::...` hanya punya read-as tertentu.');
    console.log('    Alternatif: query dengan readAs=[tradingParty, validatorParty] atau admin party.');
  } else {
    for (const { tplId, ev } of nonAmulet.slice(0, 20)) {
      console.log(`\n  TEMPLATE: ${tplId}`);
      console.log(`  contractId: ${ev.contractId || '(none)'}`);
      const args = ev.createArgument || {};
      // Dump createArgument keys + values (truncate long).
      const argStr = JSON.stringify(args, null, 2);
      console.log(`  createArgument:`, argStr.slice(0, 800));
      // Cari instrument fields.
      const inst = args.instrument || args.instrumentId || args.tokenId;
      if (inst) {
        console.log(`  → instrument field:`, JSON.stringify(inst).slice(0, 200));
      }
      // Cari amount field.
      const amt = args.amount || args.balance || args.quantity;
      if (amt) {
        const amtStr = typeof amt === 'string' ? amt : JSON.stringify(amt);
        console.log(`  → amount:`, amtStr.slice(0, 100));
      }
      // Cari owner field.
      const owner = args.owner || args.holder || args.account;
      if (owner) {
        console.log(`  → owner:`, typeof owner === 'string' ? owner.slice(0, 60) : JSON.stringify(owner).slice(0, 100));
      }
    }
  }

  console.log('\n=== SELESAI ===');
  console.log('Dari output di atas, cari template yang punya field instrument + amount + owner.');
  console.log('Itu template holding untuk token non-CC — dipakai untuk generalisasi queryTokenHoldings.');
})().catch((err) => {
  console.error('\n✗ Script error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
