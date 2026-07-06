#!/usr/bin/env node
/**
 * DRY RUN — Batch Atomic Transfer Test (1 tx, 2 exercises).
 *
 * Tujuan: buktiin kalau Canton Ledger API terima 2 ExerciseCommand dalam 1
 * submitCommand → 1 transaction → 1 updateId (tx id di explorer).
 *
 * Submit 2 transfer kecil (0.001 CC masing-masing) ke receiver + fee party
 * dalam SATU POST /v2/commands/submit-and-wait-for-transaction-tree.
 *
 * Output: tx id (updateId) + link explorer Modo.
 *
 * Usage (jalan di VPS-2 atau local yang bisa reach API):
 *   export KEYCLOAK_URL="https://oauth-canquest.nodelab.my.id"
 *   export LEDGER_API="https://api-ledger-canquest.nodelab.my.id"
 *   export VALIDATOR_API="https://api-canquest.nodelab.my.id"
 *   export LEDGER_CLIENT_ID="validator-app-backend"
 *   export LEDGER_CLIENT_SECRET="<isi-sendiri>"
 *   export LEDGER_API_ADMIN_USER="<uuid-admin>"
 *   export CANTON_DSO_PARTY_ID="<dso-party>"
 *   export CANTON_SCAN_URL="https://api-canquest.nodelab.my.id/api/validator/v0/scan-proxy"
 *
 *   node scripts/test-batch-transfer.mjs \
 *     --sender "canquests::1220..." \
 *     --receiver "verify::1220..." \
 *     --fee "canquest-fee::1220..." \
 *     --amount 0.001
 *
 * Requires Node 18+ (global fetch). No deps.
 */

// ── Args ────────────────────────────────────────────────────────────────────
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

// ── Load .env file langsung (hindari export shell yang error pada value spasi) ─
function loadEnvFile(filePath) {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes ("..." or '...')
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env tidak ditemukan — skip, andalkan env var eksplisit.
  }
}
loadEnvFile(args.env ?? '/var/www/canquest/apps/api/.env');

const SENDER = args.sender;
const RECEIVER = args.receiver;
const FEE_PARTY = args.fee;
const AMOUNT_CC = parseFloat(args.amount ?? '0.001');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const LEDGER_API = process.env.LEDGER_API_URL ?? process.env.LEDGER_API;
const VALIDATOR_API = process.env.CANTON_VALIDATOR_URL ?? process.env.VALIDATOR_API;
const CLIENT_ID = process.env.LEDGER_CLIENT_ID ?? 'validator-app-backend';
const CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET;
const ADMIN_USER = process.env.LEDGER_API_ADMIN_USER;
const DSO_PARTY = process.env.CANTON_DSO_PARTY_ID;
const SCAN_BASE = process.env.CANTON_SCAN_URL
  ?? (VALIDATOR_API ? `${VALIDATOR_API}/api/validator/v0/scan-proxy` : null);

if (!SENDER || !RECEIVER || !FEE_PARTY) {
  console.error('Usage: test-batch-transfer.mjs --sender <p> --receiver <p> --fee <p> [--amount 0.001]');
  process.exit(1);
}
const missing = [];
if (!KEYCLOAK_URL) missing.push('KEYCLOAK_URL');
if (!LEDGER_API) missing.push('LEDGER_API_URL');
if (!CLIENT_SECRET) missing.push('LEDGER_CLIENT_SECRET');
if (!ADMIN_USER) missing.push('LEDGER_API_ADMIN_USER');
if (!DSO_PARTY) missing.push('CANTON_DSO_PARTY_ID');
if (!SCAN_BASE) missing.push('CANTON_SCAN_URL or CANTON_VALIDATOR_URL');
if (missing.length > 0) {
  console.error(`\n❌ Missing env vars: ${missing.join(', ')}`);
  console.error(`   .env path: ${args.env ?? '/var/www/canquest/apps/api/.env'}`);
  console.error('\n   Cek isi .env Anda:');
  for (const m of missing) {
    const val = process.env[m] ?? '(not set)';
    console.error(`     ${m} = ${m.includes('SECRET') ? '<hidden>' : val}`);
  }
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const TIMEOUT_DEFAULT = 30_000;
async function postJson(url, body, token, timeoutMs = TIMEOUT_DEFAULT) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
  return { status: res.status, ok: res.ok, data, text };
}

function amountNumeric(n) {
  return n.toFixed(10);
}

// ── 1. Login Keycloak ───────────────────────────────────────────────────────
async function login() {
  console.log(`🔐 Logging in to Keycloak as ${CLIENT_ID}…`);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'daml_ledger_api',
  });
  const res = await fetch(`${KEYCLOAK_URL}/realms/canton/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Login failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  console.log(`✓ Token obtained (expires in ${data.expires_in}s).`);
  return data.access_token;
}

// ── 2. Get sender Amulet holdings (inputUtxo) ───────────────────────────────
async function getHoldings(token, partyId) {
  console.log(`\n📦 Querying holdings for ${partyId.split('::')[0]}…`);
  // Get ledger end offset first
  const endRes = await postJson(`${LEDGER_API}/v2/state/ledger-end`, {}, token);
  const offset = endRes.data?.offset ?? '0';

  const body = {
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [partyId]: {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
          ],
        },
      },
      verbose: true,
    },
  };
  const res = await postJson(`${LEDGER_API}/v2/state/active-contracts`, body, token, 20_000);
  if (!res.ok) throw new Error(`ACS query failed ${res.status}: ${res.text.slice(0, 200)}`);
  const arr = Array.isArray(res.data) ? res.data : [];

  // Filter PERSIS seperti queryAmuletHoldingsRaw di backend:
  //  - templateId endsWith ':Splice.Amulet:Amulet'
  //  - createArgument.owner === partyId
  //  - amount.initialAmount = nominal (string numeric)
  const holdings = [];
  for (const entry of arr) {
    const ce = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    const tpl = typeof ce?.templateId === 'string' ? ce.templateId : '';
    if (!tpl.endsWith(':Splice.Amulet:Amulet')) continue;
    const arg = ce?.createArgument ?? {};
    const owner = typeof arg.owner === 'string' ? arg.owner : '';
    if (owner !== partyId) continue; // ← filter owner, ini yang hilang
    const cid = typeof ce?.contractId === 'string' ? ce.contractId : null;
    const amtStr = arg?.amount?.initialAmount ?? '0';
    if (cid) holdings.push({ contractId: cid, amount: parseFloat(amtStr) || 0 });
  }
  holdings.sort((a, b) => b.amount - a.amount);
  console.log(`✓ Found ${holdings.length} holding(s). Total: ${holdings.reduce((s, h) => s + h.amount, 0).toFixed(6)} CC`);
  return holdings;
}

// ── 3. Call TransferFactory Registry ────────────────────────────────────────
async function callRegistry(token, choiceArguments) {
  const url = `${SCAN_BASE}/registry/transfer-instruction/v1/transfer-factory`;
  const res = await postJson(url, { choiceArguments, excludeDebugFields: true }, token, 20_000);
  if (!res.ok) {
    throw new Error(`Registry call failed ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const d = res.data ?? {};
  return {
    factoryId: d.factoryId,
    choiceContextData: d.choiceContext?.choiceContextData ?? {},
    disclosedContracts: d.choiceContext?.disclosedContracts ?? [],
    transferKind: d.transferKind,
  };
}

// ── 4. Build choiceArguments ────────────────────────────────────────────────
function buildChoiceArguments(senderPartyId, receiverPartyId, amount, inputUtxo, registry, memo) {
  return {
    expectedAdmin: DSO_PARTY,
    transfer: {
      sender: senderPartyId,
      receiver: receiverPartyId,
      amount: amountNumeric(amount),
      inputUtxo,
      meta: { values: { 'splice.lfdecentralizedtrust.org/reason': memo } },
      transferFactoryRef: {
        factory: {
          packageId: registry.factoryId.split('#')[0],
          template: registry.factoryId.split('#')[1] ?? registry.factoryId,
        },
      },
    },
    extraArgs: { context: registry.choiceContextData },
  };
}

// ── 5. Submit batch ─────────────────────────────────────────────────────────
async function submitBatch(token, exercises, actAs, disclosedContracts) {
  const body = {
    commands: exercises,
    userId: ADMIN_USER,
    commandId: `dryrun-batch-${Date.now()}`,
    actAs,
    readAs: actAs,
    disclosedContracts,
  };
  console.log(`\n🚀 Submitting BATCH (1 tx, ${exercises.length} exercises)…`);
  const url = `${LEDGER_API}/v2/commands/submit-and-wait-for-transaction-tree`;
  const res = await postJson(url, body, token, 45_000);
  return res;
}

// ── 6. Extract updateId from transactionTree ────────────────────────────────
function extractUpdateId(text) {
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    const tree = parsed.transactionTree ?? parsed;
    if (typeof tree?.updateId === 'string' && tree.updateId) return tree.updateId;
    if (typeof parsed.updateId === 'string') return parsed.updateId;
    // deep search
    const json = JSON.stringify(parsed);
    const m = json.match(/"updateId"\s*:\s*"(1220[a-f0-9]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DRY RUN — Batch Atomic Transfer Test');
    console.log('  1 tx, 2 exercises (transfer + fee)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Sender:   ${SENDER.split('::')[0]}`);
    console.log(`Receiver: ${RECEIVER.split('::')[0]}`);
    console.log(`Fee party: ${FEE_PARTY.split('::')[0]}`);
    console.log(`Amount/transfer: ${AMOUNT_CC} CC (total ${AMOUNT_CC * 2} CC)`);

    const token = await login();
    const holdings = await getHoldings(token, SENDER);

    if (holdings.length === 0) {
      console.error('\n❌ Sender has no Amulet holdings. Fund sender first.');
      process.exit(2);
    }

    // Split holdings untuk 2 exercise: exercise 1 = holdings[0], exercise 2 = sisanya.
    // Canton tidak boleh overlap inputUtxo antar exercise dalam 1 tx.
    let utxoForTransfer, utxoForFee;
    if (holdings.length >= 2) {
      utxoForTransfer = [holdings[0].contractId];
      utxoForFee = holdings.slice(1).map((h) => h.contractId);
      console.log(`\n✓ Split holdings: transfer=${utxoForTransfer.length}, fee=${utxoForFee.length}`);
    } else {
      // Coba: exercise 1 = holdings[0], exercise 2 = holdings[0] juga (mungkin Canton reject,
      // tapi test untuk lihat error message-nya informatif atau tidak).
      console.log(`\n⚠️  Hanya 1 holding. Mencoba kedua exercise pakai holding yang sama (mungkin reject)…`);
      utxoForTransfer = [holdings[0].contractId];
      utxoForFee = [holdings[0].contractId];
    }

    // Registry call untuk RECEIVER
    console.log(`\n📞 Registry call #1 (transfer → ${RECEIVER.split('::')[0]})…`);
    const reg1 = await callRegistry(token, {
      expectedAdmin: DSO_PARTY,
      transfer: {
        sender: SENDER, receiver: RECEIVER,
        amount: amountNumeric(AMOUNT_CC),
        inputUtxo: utxoForTransfer,
        meta: { values: { 'splice.lfdecentralizedtrust.org/reason': 'dryrun-transfer' } },
      },
      extraArgs: { context: {} },
    });
    console.log(`✓ Registry #1: kind=${reg1.transferKind} factory=${reg1.factoryId.slice(0, 20)}…`);

    // Registry call untuk FEE party
    console.log(`\n📞 Registry call #2 (fee → ${FEE_PARTY.split('::')[0]})…`);
    const reg2 = await callRegistry(token, {
      expectedAdmin: DSO_PARTY,
      transfer: {
        sender: SENDER, receiver: FEE_PARTY,
        amount: amountNumeric(AMOUNT_CC),
        inputUtxo: utxoForFee,
        meta: { values: { 'splice.lfdecentralizedtrust.org/reason': 'dryrun-fee' } },
      },
      extraArgs: { context: {} },
    });
    console.log(`✓ Registry #2: kind=${reg2.transferKind} factory=${reg2.factoryId.slice(0, 20)}…`);

    // Build 2 ExerciseCommand
    const factoryInterface =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';
    const exercises = [
      {
        ExerciseCommand: {
          templateId: factoryInterface,
          contractId: reg1.factoryId,
          choice: 'TransferFactory_Transfer',
          choiceArgument: buildChoiceArguments(SENDER, RECEIVER, AMOUNT_CC, utxoForTransfer, reg1, 'dryrun-transfer'),
        },
      },
      {
        ExerciseCommand: {
          templateId: factoryInterface,
          contractId: reg2.factoryId,
          choice: 'TransferFactory_Transfer',
          choiceArgument: buildChoiceArguments(SENDER, FEE_PARTY, AMOUNT_CC, utxoForFee, reg2, 'dryrun-fee'),
        },
      },
    ];

    // Gabung disclosedContracts dari kedua registry
    const allDisclosed = [...(reg1.disclosedContracts ?? []), ...(reg2.disclosedContracts ?? [])];

    // Submit batch
    const result = await submitBatch(token, exercises, [SENDER], allDisclosed);

    if (result.ok) {
      const updateId = extractUpdateId(result.data ?? result.text);
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  ✅ BATCH SUBMITTED — 1 tx, 2 exercises atomic!');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`\n Tx ID (updateId): ${updateId ?? '(tidak ter-parse, lihat response)'}`);
      if (updateId) {
        console.log(`\n 🔗 Explorer (update view):`);
        console.log(`    https://cc.modo.link/mainnet/update/${updateId}`);
        console.log(`\n 🔗 Explorer (event view):`);
        console.log(`    https://cc.modo.link/mainnet/event/${updateId}%3A0`);
      }
      console.log(`\n Full response (truncated): ${(result.text ?? '').slice(0, 500)}`);
      console.log('\n→ Buka link di atas. Kalau kelihatan 1 transaksi dengan 2 event → batch atomic WORKS. 🎉');
    } else {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log(`  ❌ BATCH FAILED — HTTP ${result.status}`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`\n Response: ${(result.text ?? '').slice(0, 800)}`);
      console.log('\n→ Error di atas kasih tahu kita kenapa batch tidak diterima.');
      console.log('  Kalau "inputUtxo overlap" → perlu split holdings (sender butuh 2+ holdings).');
      console.log('  Kalau "atomic not supported" → batch transfer tidak didukung config ini.');
    }
  } catch (err) {
    console.error(`\n💥 Script error: ${err.message ?? err}`);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }
})();
