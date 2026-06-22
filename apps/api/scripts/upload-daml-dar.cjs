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

// Ledger API URL: pakai LEDGER_API_URL (publik, e.g. https://api-ledger-canquest.nodelab.my.id)
// Fallback ke CANTON_JSON_API_URL (local 7575) kalau LEDGER_API_URL tidak diset.
const baseUrl = (process.env.LEDGER_API_URL || process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');

// Auth: pakai Keycloak client_credentials (sama seperti KeycloakTokenService backend).
// Fallback HS256 hanya kalau LEDGER_AUTH_MODE bukan 'keycloak'.
const authMode = process.env.LEDGER_AUTH_MODE || 'hs256';
const keycloakUrl = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
const keycloakRealm = process.env.KEYCLOAK_REALM || 'canton';
const clientId = process.env.LEDGER_CLIENT_ID;
const clientSecret = process.env.LEDGER_CLIENT_SECRET;
const scope = process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api';
// HS256 fallback (legacy/dev only)
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const audience = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const user = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';

/**
 * Dapatkan access token dari Keycloak (client_credentials flow).
 * Mereplikasi persis KeycloakTokenService.getToken() di backend.
 */
async function getKeycloakToken() {
  const tokenUrl = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Keycloak token request gagal (${res.status}): ${txt}`);
  }
  const data = await res.json();
  return data.access_token;
}

function signHs256Token() {
  return jwt.sign({ sub: user, aud: audience }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

async function getAccessToken() {
  if (authMode === 'keycloak') {
    if (!keycloakUrl || !clientId || !clientSecret) {
      throw new Error('LEDGER_AUTH_MODE=keycloak tapi KEYCLOAK_URL/LEDGER_CLIENT_ID/LEDGER_CLIENT_SECRET belum diset di .env');
    }
    return getKeycloakToken();
  }
  return signHs256Token();
}

function resolveLatestDar() {
  const distDir = path.join(__dirname, '..', '..', '..', 'packages', 'daml', '.daml', 'dist');
  try {
    const files = fs
      .readdirSync(distDir)
      .filter((f) => /^canquest(-v\d+)?-.*\.dar$/.test(f))
      .map((f) => ({ f, p: path.join(distDir, f), m: fs.statSync(path.join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length > 0) return files[0].p;
  } catch {
    /* ignore */
  }
  return path.join(distDir, 'canquest-0.1.1.dar');
}

const darPath = process.argv[2] || resolveLatestDar();

async function main() {
  if (!fs.existsSync(darPath)) {
    console.error('DAR not found:', darPath);
    console.error('Run: npm run daml:build (from apps/api) or docker build in packages/daml');
    process.exit(1);
  }

  console.log(`Ledger API: ${baseUrl}`);
  console.log(`Auth mode:  ${authMode}`);
  if (authMode === 'keycloak') {
    console.log(`Keycloak:   ${keycloakUrl} (realm=${keycloakRealm}, client=${clientId})`);
  }
  console.log(`DAR:        ${darPath}`);
  console.log('---');

  // ── Step 1: Dapatkan token (Keycloak atau HS256) ──
  let token;
  try {
    token = await getAccessToken();
    console.log(`✓ Token acquired (length: ${token.length})`);
  } catch (err) {
    console.error('❌ Failed to get token:', err.message);
    process.exit(1);
  }

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

  // ── Step 2: Query /v2/packages to get the full 64-char package ID ──
  const packagesUrl = `${baseUrl}/v2/packages`;
  const pkgRes = await fetch(packagesUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let pkgIdFromLedger = null;
  let pkgNameFromLedger = null;

  if (pkgRes.ok) {
    try {
      const pkgJson = await pkgRes.json();
      const details = pkgJson.packageDetails ?? [];
      // Cari package canquest di daftar package yang terdaftar
      for (const p of details) {
        if ((p.packageName ?? '').includes('canquest')) {
          // Pilih package ID paling baru (terakhir di list)
          pkgIdFromLedger = p.packageId;
          pkgNameFromLedger = p.packageName;
        }
      }
      // Kalau ada lebih dari 1 canquest package, pilih version tertinggi
      if (!pkgIdFromLedger && details.length > 0) {
        const canquestPkgs = details
          .filter((p) => (p.packageName ?? '').includes('canquest'))
          .sort((a, b) => (b.packageVersion ?? '') > (a.packageVersion ?? '') ? 1 : -1);
        if (canquestPkgs.length > 0) {
          pkgIdFromLedger = canquestPkgs[0].packageId;
          pkgNameFromLedger = canquestPkgs[0].packageName;
        }
      }
    } catch (err) {
      console.warn('⚠ Could not parse /v2/packages response:', err.message);
    }
  } else {
    console.warn('⚠ /v2/packages returned', pkgRes.status, '— trying filename fallback');
  }

  // Fallback: extract dari DAR filename suffix
  const darName = path.basename(darPath);
  const idMatch = darName.match(/-([a-f0-9]{64})\.dar$/i);
  const pkgFromDar = idMatch ? idMatch[1] : null;

  const finalPkgId = pkgIdFromLedger ?? pkgFromDar ?? null;
  const finalPkgName = pkgNameFromLedger ?? 'canquest-v11';

  // ── Step 3: Auto-update apps/api/.env ──
  const envPath = path.join(__dirname, '..', '.env');

  if (!fs.existsSync(envPath)) {
    console.error('ERROR: apps/api/.env not found at', envPath);
    console.log('');
    console.log('Manual steps:');
    console.log(`  CANTON_DAML_PACKAGE_NAME=${finalPkgName}`);
    if (finalPkgId) {
      console.log(`  CANTON_DAML_PACKAGE_ID=${finalPkgId}`);
    } else {
      console.log('  CANTON_DAML_PACKAGE_ID=<run: npm run daml:inspect>');
    }
    process.exit(finalPkgId ? 0 : 1);
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  const original = envContent;

  // Update CANTON_DAML_PACKAGE_NAME
  const nameRegex = /^(\s*CANTON_DAML_PACKAGE_NAME\s*=\s*).*$/m;
  if (nameRegex.test(envContent)) {
    envContent = envContent.replace(nameRegex, `$1${finalPkgName}`);
  } else {
    // Append if not found
    envContent += `\nCANTON_DAML_PACKAGE_NAME=${finalPkgName}\n`;
  }

  // Update CANTON_DAML_PACKAGE_ID
  if (finalPkgId) {
    const idRegex = /^(\s*CANTON_DAML_PACKAGE_ID\s*=\s*).*$/m;
    if (idRegex.test(envContent)) {
      envContent = envContent.replace(idRegex, `$1${finalPkgId}`);
    } else {
      envContent += `\nCANTON_DAML_PACKAGE_ID=${finalPkgId}\n`;
    }
  }

  if (envContent !== original) {
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('');
    console.log('✅ apps/api/.env UPDATED automatically:');
    console.log(`   CANTON_DAML_PACKAGE_NAME=${finalPkgName}`);
    if (finalPkgId) console.log(`   CANTON_DAML_PACKAGE_ID=${finalPkgId}`);
    else console.log('   CANTON_DAML_PACKAGE_ID=<NOT FOUND — run: npm run daml:inspect>');
    console.log('');
    console.log('Next: pm2 restart canquest-api --update-env');
  } else {
    console.log('ℹ apps/api/.env already up-to-date (no changes needed).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});