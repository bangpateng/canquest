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

  // ── Step 1: Upload DAR ──
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