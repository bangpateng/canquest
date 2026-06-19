#!/usr/bin/env node
/**
 * Query TransferPreapproval data NYATA dari Ledger API + Scan-Proxy.
 * HANYA query + print mentah. TIDAK ada estimasi, TIDAK ada diff.
 * 
 * Usage: node scripts/query-preapproval-data.cjs
 */

const fetch = require('node-fetch');

async function main() {
  console.log('='.repeat(80));
  console.log('QUERY PREAPPROVAL DATA NYATA');
  console.log('='.repeat(80));
  console.log('');

  // ── Env Variables ──────────────────────────────────────────────────────────
  const LEDGER_API_URL = process.env.LEDGER_API_URL;
  const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
  const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
  const LEDGER_CLIENT_ID = process.env.LEDGER_CLIENT_ID;
  const LEDGER_CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET;
  const LEDGER_API_AUTH_SCOPE = process.env.LEDGER_API_AUTH_SCOPE;
  const CANTON_FEE_PARTY_ID = process.env.CANTON_FEE_PARTY_ID;
  const CANTON_VALIDATOR_PARTY_ID = process.env.CANTON_VALIDATOR_PARTY_ID;
  const CANTON_DSO_PARTY_ID = process.env.CANTON_DSO_PARTY_ID;
  const CANTON_SCAN_URL = process.env.CANTON_SCAN_URL;

  console.log('Env Variables:');
  console.log(`  LEDGER_API_URL: ${LEDGER_API_URL}`);
  console.log(`  CANTON_FEE_PARTY_ID: ${CANTON_FEE_PARTY_ID}`);
  console.log(`  CANTON_VALIDATOR_PARTY_ID: ${CANTON_VALIDATOR_PARTY_ID}`);
  console.log(`  CANTON_DSO_PARTY_ID: ${CANTON_DSO_PARTY_ID}`);
  console.log(`  CANTON_SCAN_URL: ${CANTON_SCAN_URL}`);
  console.log('');

  // ── Step 1: Get Keycloak Token ─────────────────────────────────────────────
  console.log('[1] Getting Keycloak token...');
  const tokenRes = await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: LEDGER_CLIENT_ID,
      client_secret: LEDGER_CLIENT_SECRET,
      scope: LEDGER_API_AUTH_SCOPE,
    }),
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  if (!token) {
    console.error('ERROR: Failed to get Keycloak token');
    console.error(JSON.stringify(tokenData, null, 2));
    process.exit(1);
  }
  console.log('✓ Keycloak token obtained');
  console.log('');

  // ── Step 2: Get Ledger End Offset ──────────────────────────────────────────
  console.log('[2] Getting ledger end offset...');
  const ledgerEndRes = await fetch(`${LEDGER_API_URL}/v2/state/ledger-end`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const ledgerEndData = await ledgerEndRes.json();
  const offset = ledgerEndData.offset ?? 0;
  console.log('Ledger End:');
  console.log(JSON.stringify(ledgerEndData, null, 2));
  console.log('');

  // ── Step 3: Query TransferPreapproval for canquest-fee ────────────────────
  console.log('[3] Querying TransferPreapproval for canquest-fee...');
  const acsRes = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [CANTON_FEE_PARTY_ID]: {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            }],
          },
        },
        verbose: true,
      },
      activeAtOffset: offset,
    }),
  });
  const acsData = await acsRes.json();

  // Filter client-side for TransferPreapproval
  let preapprovalFound = false;
  for (const entry of acsData) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry;
    const active = wrapper.contractEntry;
    const jsActive = active?.JsActiveContract;
    const ev = jsActive?.createdEvent ?? wrapper;
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    if (tplId.includes('TransferPreapproval')) {
      console.log('✓ TransferPreapproval for canquest-fee FOUND:');
      console.log(JSON.stringify(ev.createArgument, null, 2));
      console.log('');
      console.log('Contract ID:', ev.contractId);
      console.log('Template ID:', ev.templateId);
      console.log('');
      preapprovalFound = true;
      break;
    }
  }

  if (!preapprovalFound) {
    console.log('✗ TransferPreapproval for canquest-fee NOT FOUND');
    console.log('ACS Response (first 3 entries):');
    console.log(JSON.stringify(acsData.slice(0, 3), null, 2));
    console.log('');
  }

  // ── Step 4: Query AmuletRules + OpenMiningRound via Scan-Proxy ────────────
  console.log('[4] Querying AmuletRules + OpenMiningRound via Scan-Proxy...');
  console.log('Calling callTransferFactoryRegistry to get disclosed contracts...');
  
  // Build dummy choiceArguments (minimal, just to get disclosed contracts)
  const dummyChoiceArguments = {
    expectedAdmin: CANTON_DSO_PARTY_ID,
    transfer: {
      sender: CANTON_VALIDATOR_PARTY_ID,
      receiver: CANTON_FEE_PARTY_ID,
      amount: '1.0000000000',
      instrumentId: {
        admin: CANTON_DSO_PARTY_ID,
        id: 'Amulet',
      },
      lock: null,
      requestedAt: new Date().toISOString(),
      executeBefore: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      inputHoldingCids: [],
      meta: { values: {} },
    },
    extraArgs: {
      context: { values: {} },
      meta: { values: {} },
    },
  };

  const registryRes = await fetch(`${CANTON_SCAN_URL}/registry/transfer-instruction/v1/transfer-factory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dummyChoiceArguments),
  });

  if (registryRes.ok) {
    const registryData = await registryRes.json();
    console.log('✓ Transfer Factory Registry Response:');
    console.log(JSON.stringify(registryData, null, 2));
    console.log('');
    
    if (registryData.disclosedContracts && Array.isArray(registryData.disclosedContracts)) {
      console.log(`Disclosed Contracts (${registryData.disclosedContracts.length} total):`);
      for (const dc of registryData.disclosedContracts) {
        const tplId = dc.templateId ?? '';
        if (tplId.includes('AmuletRules') || tplId.includes('OpenMiningRound')) {
          console.log('---');
          console.log('Template ID:', dc.templateId);
          console.log('Contract ID:', dc.contractId);
          console.log('Has createdEventBlob:', !!dc.createdEventBlob);
          if (dc.createArgument) {
            console.log('createArgument keys:', Object.keys(dc.createArgument));
          }
        }
      }
      console.log('');
    }
  } else {
    const text = await registryRes.text();
    console.log('✗ Transfer Factory Registry call failed:');
    console.log(`Status: ${registryRes.status}`);
    console.log(`Response: ${text.slice(0, 500)}`);
    console.log('');
  }

  // ── Step 5: Query Amulet Holdings for CANTON_VALIDATOR_PARTY_ID ───────────
  console.log('[5] Querying Amulet holdings for CANTON_VALIDATOR_PARTY_ID...');
  const holdingsRes = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [CANTON_VALIDATOR_PARTY_ID]: {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            }],
          },
        },
        verbose: true,
      },
      activeAtOffset: offset,
    }),
  });
  const holdingsData = await holdingsRes.json();

  // Filter client-side for Amulet holdings
  const amuletHoldings = [];
  for (const entry of holdingsData) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry;
    const active = wrapper.contractEntry;
    const jsActive = active?.JsActiveContract;
    const ev = jsActive?.createdEvent ?? wrapper;
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    if (tplId.includes('Amulet') && !tplId.includes('AmuletRules') && !tplId.includes('LockedAmulet')) {
      const args = ev.createArgument ?? {};
      const amount = args.amount?.value ?? args.amount ?? '0';
      amuletHoldings.push({
        contractId: ev.contractId,
        amount: amount,
      });
    }
  }

  console.log(`✓ Amulet Holdings for CANTON_VALIDATOR_PARTY_ID (${amuletHoldings.length} total):`);
  let totalAmount = 0;
  for (const holding of amuletHoldings) {
    console.log(`  - ${holding.contractId.slice(0, 20)}... : ${holding.amount} CC`);
    totalAmount += parseFloat(holding.amount);
  }
  console.log(`Total: ${totalAmount.toFixed(10)} CC`);
  console.log('');

  // ── Step 6: GET DSO Party ID from Scan-Proxy ───────────────────────────────
  console.log('[6] Getting DSO Party ID from Scan-Proxy...');
  const dsoRes = await fetch(`${CANTON_SCAN_URL}/dso-party-id`, {
    method: 'GET',
  });

  if (dsoRes.ok) {
    const dsoData = await dsoRes.text();
    console.log('✓ DSO Party ID from Scan-Proxy:');
    console.log(dsoData);
    console.log('');
    console.log('Matches CANTON_DSO_PARTY_ID:', dsoData.trim() === CANTON_DSO_PARTY_ID);
    console.log('');
  } else {
    const text = await dsoRes.text();
    console.log('✗ GET /dso-party-id failed:');
    console.log(`Status: ${dsoRes.status}`);
    console.log(`Response: ${text.slice(0, 500)}`);
    console.log('');
  }

  // ── Step 7: BONUS — Get exercised event AmuletRules_CreateTransferPreapproval ──
  console.log('[7] BONUS: Trying to get exercised event AmuletRules_CreateTransferPreapproval...');
  
  if (preapprovalFound) {
    // Try to get transaction tree for the preapproval contract
    // This requires knowing the updateId/offset when the contract was created
    // Since we don't have that, we'll try to query recent updates
    console.log('Querying recent updates for canquest-fee party...');
    
    const updatesRes = await fetch(`${LEDGER_API_URL}/v2/updates/trees/by-party`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        partyIds: [CANTON_FEE_PARTY_ID],
        beginOffset: Math.max(0, offset - 10000).toString(), // Last 10000 offsets
        endOffset: offset.toString(),
        verbose: true,
      }),
    });

    if (updatesRes.ok) {
      const updatesData = await updatesRes.json();
      console.log(`✓ Got ${updatesData.length ?? 0} updates`);
      
      // Search for AmuletRules_CreateTransferPreapproval exercised event
      let foundExercised = false;
      for (const update of updatesData) {
        const tree = update.transactionTree ?? update;
        const eventsById = tree.eventsById ?? {};
        
        for (const [eventId, event] of Object.entries(eventsById)) {
          if (event.exercised && event.exercised.choice === 'AmuletRules_CreateTransferPreapproval') {
            console.log('✓ FOUND AmuletRules_CreateTransferPreapproval exercised event:');
            console.log('Update ID:', tree.updateId);
            console.log('Event ID:', eventId);
            console.log('Choice Argument:');
            console.log(JSON.stringify(event.exercised.choiceArgument, null, 2));
            console.log('');
            foundExercised = true;
            break;
          }
        }
        
        if (foundExercised) break;
      }
      
      if (!foundExercised) {
        console.log('✗ AmuletRules_CreateTransferPreapproval exercised event NOT FOUND in recent updates');
        console.log('(History may have been pruned)');
        console.log('');
      }
    } else {
      const text = await updatesRes.text();
      console.log('✗ Query updates failed:');
      console.log(`Status: ${updatesRes.status}`);
      console.log(`Response: ${text.slice(0, 500)}`);
      console.log('');
    }
  } else {
    console.log('Skipping (no preapproval contract found)');
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('QUERY COMPLETE');
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
