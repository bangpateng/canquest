/**
 * Ensure demo-fcfs and demo-mix have Canton wallets (party/username).
 * Usage: node scripts/setup-demo-wallets.cjs
 */
const fs = require('fs');
const path = require('path');

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

const PASSWORD = 'TestPass123!';
const apiBase = `http://127.0.0.1:${process.env.PORT || 3001}/api`;

const TARGETS = [
  { email: 'demo-fcfs@test.local', username: 'demofcfs' },
  { email: 'demo-mix@test.local', username: 'demomix' },
];

async function login(email) {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return body.accessToken;
}

async function main() {
  for (const { email, username } of TARGETS) {
    const token = await login(email);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const meRes = await fetch(`${apiBase}/auth/me`, { headers });
    const me = await meRes.json();
    if (me.cantonPartyId && me.username) {
      console.log('OK (already has wallet):', email, me.username);
      continue;
    }

    if (!me.username) {
      const uRes = await fetch(`${apiBase}/party/username`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username }),
      });
      const uBody = await uRes.json();
      console.log('username', email, uRes.status, uBody.message ?? uBody.ok);
      if (uRes.ok && uBody.partyId) {
        console.log('  party:', uBody.partyId.slice(0, 40) + '…');
        continue;
      }
    }

    const aRes = await fetch(`${apiBase}/party/allocate`, { method: 'POST', headers });
    const aBody = await aRes.json();
    console.log('allocate', email, aRes.status, aBody.message ?? JSON.stringify(aBody));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
