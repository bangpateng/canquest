#!/usr/bin/env node
/**
 * TEST: Send 0.5 CC from reward wallet to an EXTERNAL party (offer path).
 * Proves external parties CAN receive — actAs [sender] only.
 * Run on VPS2: node test-send-external.mjs
 */
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('/var/www/canquest/apps/api/.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}

const AMEL = process.argv[2] || 'canquest-user-9bd3d1a7820c::1220d2d3f8c8a2f2e2e9e7b8af6900f62c6210c7e3905ba40b7afa34678b695cdfc6';
const SENDER = env.CANTON_REWARD_PARTY_ID;
const DSO = env.CANTON_DSO_PARTY_ID;
const SCAN = env.CANTON_SCAN_URL?.replace(/\/$/, '');
const LEDGER = env.LEDGER_API_URL?.replace(/\/$/, '');
const AMOUNT = '0.5000000000';

async function main() {
  console.log(`Sender:   ${SENDER.split('::')[0]}`);
  console.log(`Receiver: ${AMEL.split('::')[0]}`);
  console.log(`Amount:   ${AMOUNT} CC\n`);

  // Token
  const tres = await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
  });
  const { access_token: token } = await tres.json();
  console.log('[0] Token OK');

  // Step 0.5: Query sender holdings (inputHoldingCids WAJIB diisi)
  const offsetRes = await fetch(`${LEDGER}/v2/state/ledger-end`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { offset } = await offsetRes.json();
  const acsRes = await fetch(`${LEDGER}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: { [SENDER]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } },
        verbose: true,
      },
      activeAtOffset: offset,
    }),
  });
  const contracts = await acsRes.json();
  const holdings = [];
  for (const entry of contracts ?? []) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    if (!String(ev.templateId ?? '').includes('Splice.Amulet:Amulet')) continue;
    holdings.push(ev.contractId);
  }
  if (holdings.length === 0) throw new Error('Sender has no CC holdings!');
  console.log(`[0.5] Sender holdings: ${holdings.length} amulet`);

  const now = new Date().toISOString();
  const ca = {
    expectedAdmin: DSO,
    transfer: {
      sender: SENDER, receiver: AMEL, amount: AMOUNT,
      instrumentId: { admin: DSO, id: 'Amulet' },
      lock: null,
      requestedAt: now,
      executeBefore: new Date(Date.now() + 24 * 3600e3).toISOString(),
      inputHoldingCids: holdings,
      meta: { values: { 'splice.lfdecentralizedtrust.org/reason': 'Test send to external party' } },
    },
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  };

  const rres = await fetch(`${SCAN}/registry/transfer-instruction/v1/transfer-factory`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ choiceArguments: ca, excludeDebugFields: true }),
  });
  if (!rres.ok) throw new Error(`Registry ${rres.status}: ${(await rres.text()).slice(0, 200)}`);
  const reg = await rres.json();
  console.log(`[1] Registry OK: kind=${reg.transferKind} factory=${reg.factoryId.slice(0, 16)}…`);

  ca.extraArgs.context = reg.choiceContext?.choiceContextData ?? {};
  const disclosed = reg.choiceContext?.disclosedContracts ?? [];

  // Step 2: Submit — actAs [SENDER ONLY]
  const cmd = {
    commands: [{
      ExerciseCommand: {
        templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
        contractId: reg.factoryId,
        choice: 'TransferFactory_Transfer',
        choiceArgument: ca,
      },
    }],
    userId: env.LEDGER_API_ADMIN_USER,
    commandId: `test-ext-${crypto.randomUUID()}`,
    actAs: [SENDER],
    readAs: [SENDER],
    disclosedContracts: disclosed,
  };

  const sres = await fetch(`${LEDGER}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const stext = await sres.text();

  if (sres.ok) {
    const data = JSON.parse(stext);
    console.log(`[2] SUBMIT OK: updateId=${data.updateId?.slice(0, 24)}…`);
    console.log('\n✅ PASS — External party CAN receive! Offer created for amel to accept.');
    console.log('   Amel: check Offers in CanQuest wallet → Accept → Sign → CC masuk.');
  } else {
    console.log(`[2] SUBMIT FAILED ${sres.status}: ${stext.slice(0, 300)}`);
    console.log('\n❌ FAIL');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
