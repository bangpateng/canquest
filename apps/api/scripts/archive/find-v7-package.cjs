// Find canquest-v7 package ID on Canton participant
const http = require('http');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Load .env manually
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const API_URL = process.env.CANTON_JSON_API_URL ?? 'http://127.0.0.1:7575';
const SECRET = process.env.CANTON_SPLICE_SECRET;
const USER = process.env.CANTON_LEDGER_API_USER ?? 'ledger-api-user';
const AUD = process.env.CANTON_LEDGER_API_AUDIENCE ?? 'https://canton.network.global';

if (!SECRET) {
  console.log('ERROR: CANTON_SPLICE_SECRET not set in .env');
  process.exit(1);
}
const token = jwt.sign({ sub: USER, aud: AUD }, SECRET, { algorithm: 'HS256', expiresIn: '1m' });

const url = new URL('/v2/packages', API_URL);
http.get(url.href, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    try {
      const j = JSON.parse(data);
      const pkgs = j.packageDetails ?? [];
      console.log(`Total packages: ${pkgs.length}`);
      for (const p of pkgs) {
        const name = p.packageName ?? '';
        if (name.includes('canquest')) {
          console.log(`${p.packageId}  v${p.packageVersion ?? '?'}  ${name}`);
        }
      }
    } catch (e) {
      console.log('Parse error, raw (first 2000 chars):');
      console.log(data.slice(0, 2000));
    }
  });
}).on('error', (e) => console.log('HTTP error:', e.message));