/**
 * Diagnose FCFS claim fee config (read-only). Run on VPS2:
 *   cd apps/api && node scripts/diagnose-fcfs-fee.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const jwt = require('jsonwebtoken');

const EXPECTED_PREFIX = 'naxweb-validator-1::';

async function main() {
  const validatorParty = process.env.CANTON_VALIDATOR_PARTY_ID?.trim() ?? '';
  const feeRecipient = process.env.CANTON_FEE_RECIPIENT_PARTY_ID?.trim() ?? '';
  const feeUser = process.env.CANTON_FEE_ACCEPT_USERNAME?.trim() ?? 'administrator';
  const validatorUrl = (process.env.CANTON_VALIDATOR_URL ?? '').replace(/\/$/, '');
  const spliceOk = !!(validatorUrl && process.env.CANTON_SPLICE_SECRET);

  console.log('=== FCFS claim fee diagnostic (read-only) ===\n');
  console.log('DAML ClaimSession: audit only — does NOT move CC.');
  console.log('CC fee/reward: Splice TransferOffer / preapproval only.\n');

  console.log('CANTON_VALIDATOR_PARTY_ID:', validatorParty ? `${validatorParty.slice(0, 48)}…` : '(MISSING)');
  console.log('CANTON_FEE_RECIPIENT_PARTY_ID:', feeRecipient ? `${feeRecipient.slice(0, 48)}…` : '(unset → uses validator)');
  console.log('CANTON_FEE_ACCEPT_USERNAME:', feeUser);
  console.log('CANTON_VALIDATOR_URL:', validatorUrl || '(MISSING)');
  console.log('Splice configured:', spliceOk ? 'yes' : 'NO');

  if (!validatorParty) {
    console.log('\n❌ Set CANTON_VALIDATOR_PARTY_ID in .env');
    process.exit(1);
  }

  if (!validatorParty.startsWith(EXPECTED_PREFIX)) {
    console.log(`\n⚠️  Party prefix is not ${EXPECTED_PREFIX} — confirm this is your node validator wallet on ccview.`);
  }

  if (feeRecipient && feeRecipient !== validatorParty) {
    console.log('\n⚠️  FEE_RECIPIENT differs from VALIDATOR_PARTY_ID — fee may route to wrong party.');
  }

  if (!spliceOk) {
    console.log('\n❌ Splice not configured — on-chain fee cannot work.');
    process.exit(1);
  }

  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
  const aud = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  const token = jwt.sign({ sub: feeUser, aud }, secret, { algorithm: 'HS256', expiresIn: '5m' });

  const statusRes = await fetch(`${validatorUrl}/api/validator/v0/wallet/user-status`, {
    headers: { Authorization: `Bearer ${token}`, Host: host },
  });
  const statusText = await statusRes.text();
  let walletParty = null;
  let balance = null;
  if (statusRes.ok) {
    const status = JSON.parse(statusText);
    walletParty = status.party_id ?? null;
  }

  const balRes = await fetch(`${validatorUrl}/api/validator/v0/wallet/balance`, {
    headers: { Authorization: `Bearer ${token}`, Host: host },
  });
  if (balRes.ok) {
    const bal = await balRes.json();
    balance = bal.effective_unlocked_qty ?? null;
  }

  console.log('\n--- Splice wallet (@' + feeUser + ') ---');
  console.log('party_id:', walletParty ?? `(HTTP ${statusRes.status})`);
  console.log('balance CC:', balance ?? '(unavailable)');

  const partyMatch = walletParty === validatorParty;
  console.log('\nValidator party matches wallet:', partyMatch ? '✅ YES' : '❌ NO');

  if (!partyMatch && walletParty) {
    console.log('\nFix .env — use the party_id from user-status above:');
    console.log(`CANTON_VALIDATOR_PARTY_ID=${walletParty}`);
    console.log(`CANTON_FEE_RECIPIENT_PARTY_ID=${walletParty}`);
    process.exit(1);
  }

  console.log('\n✅ Config looks OK for FCFS claim fee.');
  console.log('After deploy, claim FCFS and run: pm2 logs canquest-api | grep "Claim fee step"');
  console.log('On ccview, watch party:', validatorParty.split('::')[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
