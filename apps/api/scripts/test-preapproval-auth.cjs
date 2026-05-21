#!/usr/bin/env node
/** Quick test: Splice auth + Host header for preapproval troubleshooting */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const base = process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:8080';
const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
const username = process.argv[2] ?? 'administrator';

async function tryAudience(aud) {
  const token = jwt.sign({ sub: username, aud }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const headers = { Authorization: `Bearer ${token}`, Host: host };
  const admin = await fetch(`${base}/api/validator/v0/admin/users`, { headers });
  console.log(`aud=${aud} admin/users → ${admin.status}`);
  const pre = await fetch(`${base}/api/validator/v0/wallet/transfer-preapprovals`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await pre.text();
  console.log(`aud=${aud} POST transfer-preapprovals (@${username}) → ${pre.status} ${text.slice(0, 200)}`);
}

(async () => {
  console.log('URL:', base, 'Host:', host, 'user:', username);
  for (const aud of [
    process.env.CANTON_SPLICE_AUDIENCE,
    'https://validator.example.com',
    'https://canton.network.global',
  ].filter(Boolean)) {
    await tryAudience(aud);
  }
})();
