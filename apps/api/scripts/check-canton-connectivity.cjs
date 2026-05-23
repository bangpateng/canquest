#!/usr/bin/env node
/**
 * CanQuest — Canton Connectivity Checker
 * 
 * Run on VPS 2 to verify both SSH tunnels are working:
 *   node apps/api/scripts/check-canton-connectivity.cjs
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

/** Load apps/api/.env when run from repo (canton:check does not use Nest ConfigModule). */
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

async function checkLedgerApi() {
  const baseUrl = process.env.CANTON_JSON_API_URL ?? 'http://127.0.0.1:7575';
  console.log(`\n[1] Canton JSON Ledger API — ${baseUrl}`);
  
  try {
    const res = await fetch(`${baseUrl}/livez`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      console.log('   ✅ Reachable (/livez → HTTP 200)');
      return true;
    } else {
      console.log(`   ⚠️  Reachable but status ${res.status}`);
      return false;
    }
  } catch (err) {
    console.log(`   ❌ NOT reachable: ${err.message}`);
    console.log('   Fix: ssh -N -L 7575:<PARTICIPANT_DOCKER_IP>:7575 root@VPS1_IP');
    return false;
  }
}

async function checkValidatorApi() {
  const baseUrl = process.env.CANTON_VALIDATOR_URL ?? 'http://127.0.0.1:5003';
  const secret = process.env.CANTON_SPLICE_SECRET ?? 'unsafe';
  const audience = process.env.CANTON_SPLICE_AUDIENCE ?? 'https://validator.example.com';
  // Same JWT sub as SpliceValidatorService.adminToken() — not CANTON_VALIDATOR_ADMIN_USER
  const jwtSub = process.env.CANTON_LEDGER_API_USER ?? 'ledger-api-user';
  
  console.log(`\n[2] Splice Validator API — ${baseUrl}`);
  console.log(`   (JWT sub=${jwtSub}, aud=${audience})`);
  
  const token = jwt.sign(
    { sub: jwtSub, aud: audience },
    secret,
    { algorithm: 'HS256', expiresIn: '5m' },
  );

  const host = process.env.CANTON_VALIDATOR_HOST_HEADER ?? 'wallet.localhost';
  const headers = { Authorization: `Bearer ${token}`, Host: host };

  try {
    const res = await fetch(`${baseUrl}/api/validator/v0/admin/users`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok || res.status === 401 || res.status === 403) {
      // Any HTTP response means server is reachable
      const text = await res.text();
      if (res.ok) {
        console.log(`   ✅ Reachable and authenticated (HTTP ${res.status})`);
        try {
          const data = JSON.parse(text);
          console.log(`   Users visible: ${JSON.stringify(data).slice(0, 150)}`);
        } catch { /* ignore */ }
        return true;
      } else {
        console.log(`   ⚠️  Reachable but auth failed (HTTP ${res.status})`);
        console.log('   Check CANTON_SPLICE_SECRET, CANTON_SPLICE_AUDIENCE, CANTON_LEDGER_API_USER');
        return false;
      }
    } else {
      console.log(`   ⚠️  HTTP ${res.status}`);
      return false;
    }
  } catch (err) {
    console.log(`   ❌ NOT reachable: ${err.message}`);
    console.log('   Fix: ssh -N -L 8080:localhost:80 root@VPS1_IP  (set CANTON_VALIDATOR_URL=http://127.0.0.1:8080)');
    return false;
  }
}

async function checkDatabase() {
  console.log('\n[3] PostgreSQL (DATABASE_URL)');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('   ⚠️  DATABASE_URL not set in .env');
    return false;
  }
  console.log('   ℹ️  DATABASE_URL is set (run `npx prisma db push` to test connection)');
  return true;
}

async function main() {
  console.log('=== CanQuest Canton Connectivity Check ===');
  
  const ledgerOk = await checkLedgerApi();
  const validatorOk = await checkValidatorApi();
  await checkDatabase();

  console.log('\n=== Summary ===');
  console.log(`Canton JSON API:    ${ledgerOk ? '✅ OK' : '❌ FAIL'}`);
  console.log(`Splice Validator:   ${validatorOk ? '✅ OK' : '❌ FAIL'}`);
  
  if (!ledgerOk || !validatorOk) {
    console.log('\n⚠️  Some connections failed. Check SSH tunnels on VPS 2.');
    console.log('   Run: systemctl status canton-tunnel-ledger canton-tunnel-validator');
    console.log('   Or:  infra/vps2-setup-tunnels.sh');
  } else {
    console.log('\n✅ All Canton connections working!');
  }
}

main().catch(console.error);
