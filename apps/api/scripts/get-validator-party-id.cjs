#!/usr/bin/env node
/**
 * CanQuest — Get validator / admin wallet Party ID (TestNet & DevNet)
 *
 *   node apps/api/scripts/get-validator-party-id.cjs
 *   node apps/api/scripts/get-validator-party-id.cjs my-validator-hint
 *
 * Splice 0.6.x often returns only {"usernames":["administrator"]} on GET /admin/users
 * and 404 on GET /admin/users/{name}. Party ID is resolved via Canton JSON API /v2/parties.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const AUDIENCES = [
  process.env.CANTON_SPLICE_AUDIENCE,
  'https://validator.example.com',
  'https://canton.network.global',
].filter(Boolean);

function spliceHeaders(secret, aud, sub, host) {
  const token = jwt.sign({ sub, aud }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  return { Authorization: `Bearer ${token}`, Host: host };
}

async function fetchPartyFromLedger(ledgerBase, secret, username) {
  const ledgerUser = process.env.CANTON_LEDGER_API_USER ?? 'ledger-api-user';
  const ledgerAud =
    process.env.CANTON_LEDGER_API_AUDIENCE ?? 'https://canton.network.global';
  const token = jwt.sign(
    { sub: ledgerUser, aud: ledgerAud },
    secret,
    { algorithm: 'HS256', expiresIn: '5m' },
  );
  const res = await fetch(`${ledgerBase}/v2/parties`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`   Ledger /v2/parties → HTTP ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const data = JSON.parse(text);
  const hint = username.toLowerCase();
  const parties = (data.partyDetails ?? []).map((p) => p.party).filter(Boolean);
  const exact = parties.filter((p) => p.split('::')[0]?.toLowerCase() === hint);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    console.log(`   Multiple parties for "${username}":`, exact);
    return exact[0];
  }
  const prefix = parties.filter((p) => p.toLowerCase().startsWith(`${hint}::`));
  return prefix[0] ?? null;
}

async function confirmWalletUser(validatorBase, secret, aud, username, host) {
  const res = await fetch(`${validatorBase}/api/validator/v0/wallet/balance`, {
    headers: spliceHeaders(secret, aud, username, host),
    signal: AbortSignal.timeout(8_000),
  });
  return res.ok;
}

function printEnvLines(partyId) {
  console.log('\n✅ Party ID found!\n');
  console.log(partyId);
  console.log('\nAdd to apps/api/.env (section 6c):\n');
  console.log(`CANTON_VALIDATOR_PARTY_ID=${partyId}`);
  console.log(`CANTON_APP_PROVIDER_PARTY_ID=${partyId}`);
  console.log(`CANTON_OPERATOR_PARTY_ID=${partyId}\n`);
}

async function main() {
  const validatorBase = (process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:8080').replace(
    /\/$/,
    '',
  );
  const ledgerBase = (process.env.CANTON_JSON_API_URL ?? 'http://127.0.0.1:7575').replace(
    /\/$/,
    '',
  );
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
  const username =
    process.argv[2] ?? process.env.CANTON_VALIDATOR_ADMIN_USER ?? 'administrator';

  console.log(`\nResolving party for Splice user "${username}"`);
  console.log(`Validator: ${validatorBase}  Ledger: ${ledgerBase}\n`);

  // 1) Splice list (sanity — user exists in wallet)
  const listAud = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  const listRes = await fetch(`${validatorBase}/api/validator/v0/admin/users`, {
    headers: spliceHeaders(secret, listAud, 'ledger-api-user', host),
  });
  if (listRes.ok) {
    const list = await listRes.json();
    const names = list.usernames ?? [];
    console.log(`Splice users: ${JSON.stringify(names)}`);
    if (!names.includes(username)) {
      console.log(`⚠️  "${username}" not in Splice user list — wallet UI may use another name.`);
    }
  }

  if (await confirmWalletUser(validatorBase, secret, listAud, username, host)) {
    console.log(`Wallet API: user "${username}" has balance (wallet OK)`);
  }

  // 2) Legacy GET /admin/users/{name} (works on some DevNet builds)
  for (const aud of [...new Set(AUDIENCES)]) {
    for (const sub of ['ledger-api-user', username]) {
      try {
        const res = await fetch(
          `${validatorBase}/api/validator/v0/admin/users/${encodeURIComponent(username)}`,
          {
            headers: spliceHeaders(secret, aud, sub, host),
            signal: AbortSignal.timeout(8_000),
          },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.party_id) {
            console.log(`\n(from Splice GET /admin/users/${username})`);
            printEnvLines(data.party_id);
            return;
          }
        }
      } catch {
        /* try ledger */
      }
    }
  }

  console.log('\nSplice per-user endpoint unavailable (common on 0.6.x) — querying ledger /v2/parties…');
  const partyId = await fetchPartyFromLedger(ledgerBase, secret, username);
  if (partyId) {
    printEnvLines(partyId);
    return;
  }

  console.error(`\n❌ No party matching "${username}".`);
  console.error('On VPS: curl -s http://127.0.0.1:7575/v2/parties | grep -i administrator');
  process.exit(1);
}

main();
