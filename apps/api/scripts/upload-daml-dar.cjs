/**
 * Upload CanQuest DAR to Canton JSON Ledger API (tunnel 7575).
 * Usage: node scripts/upload-daml-dar.cjs [path-to.dar]
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

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

const baseUrl = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const audience = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const user = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';

const darPath =
  process.argv[2] ||
  path.join(__dirname, '..', '..', '..', 'packages', 'daml', '.daml', 'dist', 'canquest-0.1.1.dar');

async function main() {
  if (!fs.existsSync(darPath)) {
    console.error('DAR not found:', darPath);
    console.error('Run: npm run daml:build (from apps/api) or docker build in packages/daml');
    process.exit(1);
  }

  const token = jwt.sign({ sub: user, aud: audience }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });

  const body = fs.readFileSync(darPath);
  const res = await fetch(`${baseUrl}/v2/packages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('Upload failed', res.status, text.slice(0, 500));
    process.exit(1);
  }

  console.log('Upload OK:', text || res.status);
  console.log('');
  const pkg = process.env.CANTON_DAML_PACKAGE_ID || '(run daml damlc inspect-dar on the .dar)';
  console.log('Add to apps/api/.env:');
  console.log('CANTON_DAML_PACKAGE_ID=' + pkg);
  console.log('CANTON_OPERATOR_PARTY_ID=' + (process.env.CANTON_VALIDATOR_PARTY_ID || '<operator-party>'));
  console.log('Then restart: npm run start:dev');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
