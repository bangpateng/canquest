/**
 * Verify fee treasury matches validator on ccview (naxweb-validator-1).
 * Usage: node scripts/test-fee-collect.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const EXPECTED =
  'naxweb-validator-1::1220cc5cc83730c8d5fb167626147133848cf69be6962f143be0c39d3e11a8546e8d';

async function main() {
  const feeUser = process.env.CANTON_FEE_ACCEPT_USERNAME ?? 'administrator';
  const feeParty =
    process.env.CANTON_FEE_RECIPIENT_PARTY_ID ??
    process.env.CANTON_VALIDATOR_PARTY_ID ??
    '';

  console.log('Expected validator (ccview):', EXPECTED.split('::')[0]);
  console.log('CANTON_FEE_ACCEPT_USERNAME:', feeUser);
  console.log('CANTON_FEE_RECIPIENT_PARTY_ID:', feeParty ? `${feeParty.slice(0, 40)}…` : '(unset)');
  console.log('TRANSACTION_FEE_CC:', process.env.TRANSACTION_FEE_CC ?? '5');

  const jwt = require('jsonwebtoken');
  const base = (process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
  const aud = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  const token = jwt.sign({ sub: feeUser, aud }, secret, { algorithm: 'HS256', expiresIn: '5m' });

  const statusRes = await fetch(`${base}/api/validator/v0/wallet/user-status`, {
    headers: { Authorization: `Bearer ${token}`, Host: host },
  });
  const status = statusRes.ok ? await statusRes.json() : null;
  const walletParty = status?.party_id ?? null;

  console.log('\nSplice wallet user-status:');
  console.log('  party_id:', walletParty ?? '(failed)');

  const partyMatch = feeParty === EXPECTED || walletParty === EXPECTED;
  const userOk = feeUser === 'administrator';

  console.log('\nChecks:');
  console.log('  Treasury party = naxweb-validator-1?', partyMatch ? 'YES' : 'NO');
  console.log('  Fee accept user = administrator?', userOk ? 'YES' : 'NO');

  if (!partyMatch) {
    console.log('\nFix apps/api/.env:');
    console.log(`CANTON_VALIDATOR_PARTY_ID=${EXPECTED}`);
    console.log(`CANTON_FEE_RECIPIENT_PARTY_ID=${EXPECTED}`);
    console.log('CANTON_FEE_ACCEPT_USERNAME=administrator');
    console.log('(Splice login "administrator" owns the naxweb-validator-1 party on this node.)');
  } else {
    console.log('\nFee config OK — restart API and test Send CC from web.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
