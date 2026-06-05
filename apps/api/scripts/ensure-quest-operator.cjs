/**
 * Create (or resolve) a dedicated Splice wallet user for CanQuest DAML operator.
 * Separate from CANTON_VALIDATOR_PARTY_ID (treasury / fees).
 *
 * Usage:
 *   node scripts/ensure-quest-operator.cjs
 *   node scripts/ensure-quest-operator.cjs canquest-operator
 *
 * Requires: tunnel 7575 + 8080, CANTON_DAML_PACKAGE_ID, CANTON_VALIDATOR_PARTY_ID (suffix anchor)
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
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
const validatorBase = (process.env.CANTON_VALIDATOR_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const host = process.env.CANTON_VALIDATOR_HOST_HEADER || 'wallet.localhost';
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const spliceAud = process.env.CANTON_SPLICE_AUDIENCE || 'https://validator.example.com';
const ledgerAud = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const ledgerUser = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';
const pkgName = process.env.CANTON_DAML_PACKAGE_NAME?.trim() || 'canquest-v4';
const pkgRef = pkgName.startsWith('#') ? pkgName : `#${pkgName}`;
const validatorAnchor = process.env.CANTON_VALIDATOR_PARTY_ID?.trim();
// canquest-v4: probe dengan UserAccount (template yang pasti ada di Main.daml)
const PROBE_TPL = `${pkgRef}:Main:UserAccount`;

function partySuffix(partyId) {
  const i = partyId?.indexOf('::');
  return i >= 0 ? partyId.slice(i + 2).toLowerCase() : null;
}

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
    console.log(`Splice user "${name}" already exists — resolving party…`);
    return null;
  }
  if (!res.ok) {
    console.error(`create user failed ${res.status}:`, text.slice(0, 400));
    return null;
  }
  const data = JSON.parse(text);
  return data.party_id || null;
}

async function spliceWalletParty(username) {
  for (const aud of [...new Set([spliceAud, 'https://validator.example.com'])]) {
    const token = jwt.sign({ sub: username, aud }, secret, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    try {
      const res = await fetch(`${validatorBase}/api/validator/v0/wallet/user-status`, {
        headers: { Authorization: `Bearer ${token}`, Host: host },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return data.party_id?.trim() || null;
    } catch {
      /* try next aud */
    }
  }
  return null;
}

async function grantUserRights(partyId) {
  const res = await fetch(
    `${ledgerBase}/v2/users/${encodeURIComponent(ledgerUser)}/rights`,
    {
      method: 'POST',
      headers: ledgerHeaders(),
      body: JSON.stringify({
        identityProviderId: '',
        userId: ledgerUser,
        rights: [
          { kind: { CanActAs: { value: { party: partyId } } } },
          { kind: { CanReadAs: { value: { party: partyId } } } },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    console.warn(`grantUserRights ${res.status}:`, text.slice(0, 200));
    return false;
  }
  console.log('grantUserRights OK for', partyId.split('::')[0]);
  return true;
}

async function probeSubmit(partyId) {
  // canquest-v4: probe dengan membuat UserAccount contract
  // Ini membuktikan bahwa DAR canquest-v4 sudah ter-upload dan operator bisa submit
  const templateId = PROBE_TPL;
  const res = await fetch(`${ledgerBase}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: ledgerHeaders(),
    body: JSON.stringify({
      commands: [
        {
          CreateCommand: {
            templateId,
            createArguments: {
              admin:        partyId,
              userAddress:  partyId,
              username:     'operator-probe',
              earnedPoints: 0,
              spentPoints:  0,
              createdAt:    new Date().toISOString(),
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
  console.log('Ledger submit probe OK (canquest-v4 Main:UserAccount)');
  return true;
}

function assertParticipantSuffix(partyId) {
  if (!validatorAnchor || !validatorAnchor.includes('::')) return true;
  const expected = partySuffix(validatorAnchor);
  const got = partySuffix(partyId);
  if (expected && got && expected !== got) {
    console.error(
      `\nParticipant suffix mismatch!\n  operator: …${got?.slice(-16)}\n  validator: …${expected?.slice(-16)}\nFix tunnel — 7575 must target TestNet participant 172.18.0.5\n`,
    );
    return false;
  }
  return true;
}

async function main() {
  console.log('=== Ensure quest operator party (separate from validator treasury) ===\n');
  console.log('Splice username:', operatorName);
  console.log('Validator anchor:', validatorAnchor || '(not set)');
  console.log('');

  let partyId = await createSpliceUser(operatorName);
  if (!partyId) {
    partyId = await spliceWalletParty(operatorName);
  }

  if (!partyId) {
    console.error(`
Could not create or resolve Splice user "${operatorName}".

Fix:
  1. Tunnel 7575 + 8080 to TestNet 162.250.190.204 (172.18.0.5 + 172.18.0.7)
  2. Re-run: node scripts/ensure-quest-operator.cjs ${operatorName}
`);
    process.exit(1);
  }

  if (!assertParticipantSuffix(partyId)) process.exit(1);

  await grantUserRights(partyId);

  const ok = await probeSubmit(partyId);
  if (!ok) {
    console.error(`
Party ${partyId} exists but DAML probe failed.
Check CANTON_DAML_PACKAGE_ID and that DAR is uploaded on this participant.
`);
    process.exit(1);
  }

  console.log('\n✅ Dedicated quest operator party:\n');
  console.log(partyId);
  console.log('\nUpdate apps/api/.env:\n');
  console.log(`CANTON_OPERATOR_PARTY_ID=${partyId}`);
  console.log(`\nKeep separate (treasury / fees / rewards):`);
  console.log(`CANTON_VALIDATOR_PARTY_ID=${validatorAnchor || 'naxweb-validator-1::1220cc5c…'}`);
  console.log(`CANTON_APP_PROVIDER_PARTY_ID=${validatorAnchor || '…'}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
