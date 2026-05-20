#!/usr/bin/env node
/**
 * CanQuest — Get Validator Party ID from Splice API
 * 
 * Run on VPS 2 (after SSH tunnels are active):
 *   node apps/api/scripts/get-validator-party-id.cjs
 * 
 * This prints the Party ID of the validator admin user,
 * which you should set as CANTON_VALIDATOR_PARTY_ID in .env
 */

const jwt = require('jsonwebtoken');

async function main() {
  const baseUrl = process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:5003';
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const audience = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  const adminUser = process.env.CANTON_VALIDATOR_ADMIN_USER ?? 'administrator';

  const token = jwt.sign(
    { sub: adminUser, aud: audience },
    secret,
    { algorithm: 'HS256', expiresIn: '5m' },
  );

  console.log(`\nFetching Party ID for "${adminUser}" from ${baseUrl}...\n`);

  try {
    const res = await fetch(`${baseUrl}/api/validator/v0/admin/users/${adminUser}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}`);
    
    if (!res.ok) {
      console.error('Error response:', text.slice(0, 500));
      process.exit(1);
    }

    const data = JSON.parse(text);
    const partyId = data.party_id;
    
    if (!partyId) {
      console.error('No party_id in response:', text.slice(0, 500));
      process.exit(1);
    }

    console.log('✅ Validator Party ID found!\n');
    console.log(`party_id: ${partyId}\n`);
    console.log('Add this to apps/api/.env:');
    console.log(`CANTON_VALIDATOR_PARTY_ID="${partyId}"\n`);
  } catch (err) {
    console.error('❌ Failed to connect:', err.message);
    console.error('Make sure the SSH tunnel is active: ssh -N -L 5003:<DOCKER_IP>:5003 root@VPS1_IP');
    process.exit(1);
  }
}

main();
