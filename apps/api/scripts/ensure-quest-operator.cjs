/**
 * Create (or resolve) a Splice wallet user for quest DAML operator on TestNet.
 * The operator party must be onboarded on the global synchronizer — ledger-only
 * parties like administrator::1220019a... often cannot submit commands.
 *
 * Usage:
 *   node scripts/ensure-quest-operator.cjs
 *   node scripts/ensure-quest-operator.cjs canquest-operator
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const operatorName = (process.argv[2] || 'canquest-operator').trim().toLowerCase();
const ledgerBase = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const validatorBase = (process.env.CANTON_VALIDATOR_URL || 'http://127.0.0.1:8080').replace(
  /\/$/,
  '',
);
const host = process.env.CANTON_VALIDATOR_HOST_HEADER || 'wallet.localhost';
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const spliceAud =
  process.env.CANTON_SPLICE_AUDIENCE || 'https://validator.example.com';
const ledgerAud =
  process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const ledgerUser = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';
const pkg = process.env.CANTON_DAML_PACKAGE_ID?.trim();

function spliceAdminHeaders() {
  const token = jwt.sign({ sub: 'ledger-api-user', aud: spliceAud }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  return {
    Authorization: `Bearer ${token}`,
    Host: host,
    'Content-Type': 'application/json',
  };
}

function ledgerHeaders() {
  const token = jwt.sign({ sub: ledgerUser, aud: ledgerAud }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function createSpliceUser(name) {
  const res = await fetch(`${validatorBase}/api/validator/v0/admin/users`, {
    method: 'POST',
    headers: spliceAdminHeaders(),
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (res.status === 409) {
    console.log(`Splice user "${name}" already exists — resolving party via ledger test…`);
    return null;
  }
  if (!res.ok) {
    console.error(`create user failed ${res.status}:`, text.slice(0, 400));
    return null;
  }
  const data = JSON.parse(text);
  return data.party_id || null;
}

async function probeSubmit(partyId) {
  if (!pkg) {
    console.log('Skip ledger probe — CANTON_DAML_PACKAGE_ID not set');
    return false;
  }
  const res = await fetch(`${ledgerBase}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: ledgerHeaders(),
    body: JSON.stringify({
      commands: [
        {
          CreateCommand: {
            templateId: `${pkg}:Main:QuestTaskSubmission`,
            createArguments: {
              operator: partyId,
              user: partyId,
              questId: 'probe-quest',
              taskId: 'probe-task',
              proof: 'probe',
              submittedAt: new Date().toISOString(),
              verified: true,
            },
          },
        },
      ],
      userId: ledgerUser,
      commandId: randomUUID(),
      actAs: [partyId],
      readAs: [partyId],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`Ledger submit probe failed ${res.status}:`, text.slice(0, 300));
    return false;
  }
  console.log('Ledger submit probe OK');
  return true;
}

async function resolvePartyByProbe(candidates) {
  for (const p of candidates) {
    if (!p) continue;
    if (await probeSubmit(p)) return p;
  }
  return null;
}

async function main() {
  console.log('=== Ensure quest operator party (TestNet) ===\n');
  console.log('Target Splice username:', operatorName);

  let partyId = await createSpliceUser(operatorName);

  if (!partyId) {
    const fromEnv = process.env.CANTON_OPERATOR_PARTY_ID?.trim();
    const hildaHint = process.argv[3]?.trim();
    const candidates = [fromEnv, hildaHint].filter(Boolean);
    if (candidates.length) {
      console.log('\nProbing candidate party IDs for synchronizer submit…');
      partyId = await resolvePartyByProbe(candidates);
    }
  } else {
    const ok = await probeSubmit(partyId);
    if (!ok) partyId = null;
  }

  if (!partyId) {
    console.error(`
Could not find a party that can submit on this participant.

administrator::1220019a... is often visible on GET /v2/parties but NOT onboarded on the
TestNet synchronizer (NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT).

Fix:
  1. Keep tunnel open (7575 + 8080)
  2. Re-run: node scripts/ensure-quest-operator.cjs canquest-operator
  3. Or use a known-good party (e.g. hilda after wallet create) ONLY for local dev:
     CANTON_OPERATOR_PARTY_ID=hilda::1220cc5c...
`);
    process.exit(1);
  }

  console.log('\n✅ Quest operator party (can submit on synchronizer):\n');
  console.log(partyId);
  console.log('\nUpdate apps/api/.env section 6c:\n');
  console.log(`CANTON_OPERATOR_PARTY_ID=${partyId}`);
  console.log(
    '\nKeep CANTON_VALIDATOR_PARTY_ID / CANTON_APP_PROVIDER_PARTY_ID as your validator wallet party if needed for fees — operator may differ.\n',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
