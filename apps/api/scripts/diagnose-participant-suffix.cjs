#!/usr/bin/env node
/**
 * Compare Canton participant suffixes: validator anchor vs ledger parties vs Splice user.
 *
 *   node scripts/diagnose-participant-suffix.cjs
 *   node scripts/diagnose-participant-suffix.cjs naxweb
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const anchor =
  process.env.CANTON_VALIDATOR_PARTY_ID ||
  process.env.CANTON_APP_PROVIDER_PARTY_ID ||
  '';
const suffix = (id) => {
  const i = id.indexOf('::');
  return i < 0 ? null : id.slice(i + 2).toLowerCase();
};

async function ledgerParties() {
  const base = (process.env.CANTON_JSON_API_URL ?? 'http://127.0.0.1:7575').replace(/\/$/, '');
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const aud = process.env.CANTON_LEDGER_API_AUDIENCE ?? 'https://canton.network.global';
  const sub = process.env.CANTON_LEDGER_API_USER ?? 'ledger-api-user';
  const token = jwt.sign({ sub, aud }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const res = await fetch(`${base}/v2/parties`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ledger /v2/parties HTTP ${res.status}`);
  const data = await res.json();
  return (data.partyDetails ?? []).map((p) => p.party).filter(Boolean);
}

async function spliceUserParty(username) {
  const base = (process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const aud = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
  const token = jwt.sign({ sub: username, aud }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const res = await fetch(`${base}/api/validator/v0/wallet/user-status`, {
    headers: { Authorization: `Bearer ${token}`, Host: host },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.party_id ?? null;
}

(async () => {
  const hint = process.argv[2]?.toLowerCase();
  console.log('\n=== Participant suffix check (TestNet) ===\n');
  if (!anchor.includes('::')) {
    console.error('Set CANTON_VALIDATOR_PARTY_ID in .env first.');
    process.exit(1);
  }
  const anchorSuffix = suffix(anchor);
  console.log('Validator anchor:', anchor);
  console.log('Expected suffix:  ', anchorSuffix?.slice(0, 24) + '…\n');

  const parties = await ledgerParties();
  const bySuffix = new Map();
  for (const p of parties) {
    const s = suffix(p);
    if (!s) continue;
    if (!bySuffix.has(s)) bySuffix.set(s, []);
    bySuffix.get(s).push(p);
  }
  console.log(`Ledger participant groups (${bySuffix.size} distinct suffixes on :7575):`);
  for (const [s, list] of bySuffix) {
    const ok = s === anchorSuffix;
    console.log(`  ${ok ? '✅' : '❌'} …${s.slice(-20)} (${list.length} parties)`);
    if (!ok && list.length <= 5) list.forEach((p) => console.log(`       ${p}`));
  }

  if (hint) {
    const match = parties.filter((p) => p.split('::')[0]?.toLowerCase() === hint);
    console.log(`\nLedger parties for hint "${hint}":`, match.length ? match : '(none)');
    const sp = await spliceUserParty(hint);
    if (sp) {
      console.log(`Splice wallet user-status: ${sp}`);
      console.log(suffix(sp) === anchorSuffix ? '  ✅ suffix matches validator' : '  ❌ suffix MISMATCH');
    } else {
      console.log(`Splice wallet user-status for "${hint}": not reachable or 403`);
    }
  }

  if (bySuffix.size > 1) {
    console.log(
      '\n⚠️  Multiple participants on :7575 — wallet fallback may create wrong suffix (12200dd7… vs 1220cc5c…).',
    );
    console.log('Fix: point tunnel 7575 to splice-validator-participant-1 on 162.250.190.204 (TestNet).');
  }
  console.log('');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
