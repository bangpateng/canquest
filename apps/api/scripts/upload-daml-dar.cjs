#!/usr/bin/env node
/**
 * Upload CanQuest DAR ke Canton JSON Ledger API.
 *
 * Usage:
 *   node scripts/upload-daml-dar.cjs [path-to.dar]
 *   node scripts/upload-daml-dar.cjs                    # auto-detect DAR terbaru
 *
 * Env (dari apps/api/.env):
 *   LEDGER_API_URL / CANTON_JSON_API_URL  — participant base URL (default 127.0.0.1:7575)
 *   LEDGER_AUTH_MODE=keycloak             — mode auth (wajib utk produksi)
 *   KEYCLOAK_URL, KEYCLOAK_REALM          — Keycloak issuer
 *   LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET — client_credentials
 *   LEDGER_API_AUTH_SCOPE                 — default daml_ledger_api
 *
 * Fix history (v24, 2026-08-06):
 *   - Endpoint SALAH: /v2/packages → /v2/dars (Canton JSON API v2 DAR upload)
 *   - Hardcode fallback 'canquest-v11' → hapus, baca dari DAR filename
 *   - Auto-overwrite .env paksa → hapus. Print manual instruction aja.
 *     (Backend auto-resolve package via CANTON_DAML_PACKAGE_NAME=#canquest-v24.)
 *
 * Alternatif tanpa script ini: lihat docs/RUNBOOK_DAML_V24_DEPLOY.md §3 (curl manual).
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

const baseUrl = (process.env.LEDGER_API_URL || process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const authMode = process.env.LEDGER_AUTH_MODE || 'hs256';
const keycloakUrl = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
const keycloakRealm = process.env.KEYCLOAK_REALM || 'canton';
const clientId = process.env.LEDGER_CLIENT_ID;
const clientSecret = process.env.LEDGER_CLIENT_SECRET;
const scope = process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api';

async function getKeycloakToken() {
  if (!keycloakUrl || !clientId || !clientSecret) {
    throw new Error(
      'LEDGER_AUTH_MODE=keycloak tapi KEYCLOAK_URL / LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET belum diset di .env',
    );
  }
  const tokenUrl = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope });
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

function resolveLatestDar() {
  const distDir = path.join(__dirname, '..', '..', '..', 'packages', 'daml', '.daml', 'dist');
  try {
    const files = fs
      .readdirSync(distDir)
      .filter((f) => /^canquest.*-.*\.dar$/.test(f))
      .map((f) => ({ p: path.join(distDir, f), m: fs.statSync(path.join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length > 0) return files[0].p;
  } catch {
    /* ignore */
  }
  return null;
}

const darPath = process.argv[2] || resolveLatestDar();

async function main() {
  if (!darPath || !fs.existsSync(darPath)) {
    console.error('❌ DAR tidak ditemukan:', darPath ?? '(null)');
    console.error('   Build dulu: cd packages/daml && daml build');
    console.error('   Atau beri path: node scripts/upload-daml-dar.cjs /path/to/canquest-v24-1.2.0.dar');
    process.exit(1);
  }

  console.log(`Ledger API: ${baseUrl}`);
  console.log(`Auth mode:  ${authMode}`);
  if (authMode === 'keycloak') {
    console.log(`Keycloak:   ${keycloakUrl} (realm=${keycloakRealm}, client=${clientId})`);
  }
  console.log(`DAR:        ${darPath}`);
  console.log('---');

  // Step 1: token
  let token;
  try {
    token = await getKeycloakToken();
    console.log(`✓ Token acquired (length: ${token.length})`);
  } catch (err) {
    console.error('❌ Failed to get token:', err.message);
    process.exit(1);
  }

  // Step 2: upload via /v2/dars (FIX: endpoint lama /v2/packages SALAH)
  const body = fs.readFileSync(darPath);
  const res = await fetch(`${baseUrl}/v2/dars`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ Upload gagal (HTTP ${res.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }

  console.log(`✅ Upload OK (HTTP ${res.status}): ${text || '(empty body = sukses)'}`);
  console.log('');

  // Step 3: info package (dari filename, bukan hardcode)
  // DAR filename format: canquest-v24-1.2.0.dar → packageName=canquest-v24
  const darName = path.basename(darPath);
  const nameMatch = darName.match(/^(canquest-v?\d+)-/);
  const versionMatch = darName.match(/-(\d+\.\d+\.\d+)\.dar$/);
  const pkgName = nameMatch ? nameMatch[1] : 'canquest';
  const pkgVersion = versionMatch ? versionMatch[1] : '?';

  console.log('📋 DAR uploaded:');
  console.log(`   Package name:    ${pkgName}`);
  console.log(`   Package version: ${pkgVersion}`);
  console.log('');
  console.log('📌 Backend akan auto-resolve template via CANTON_DAML_PACKAGE_NAME.');
  console.log('   Pastikan apps/api/.env ada baris (dengan tanda #):');
  console.log(`     CANTON_DAML_PACKAGE_NAME=#${pkgName}`);
  console.log('');
  console.log('   Backend tidak butuh CANTON_DAML_PACKAGE_ID (auto-resolve via prefix).');
  console.log('');
  console.log('Next: pm2 restart canquest-api --update-env');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
