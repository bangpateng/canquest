#!/usr/bin/env node
/**
 * M0 spike — langkah 1: probe jaringan + auth (READ-ONLY, tidak ada transaksi).
 *
 * Kenapa pinning IP? DNS LAN PC ini meng-override *.canquestlabs.com ke
 * 10.90.19.188 (proxy lokal yang mati), jadi koneksi by-hostname gagal.
 * Skrip ini me-resolve record publik via DNS publik (1.1.1.1), lalu konek
 * ke IP publik dengan TLS SNI + Host header = hostname asli. Cloudflare
 * merutekan berdasarkan SNI/Host, jadi layanan tetap benar.
 *
 * Yang dilakukan:
 *   1. Resolve A record publik auth/validator/ledger *.canquestlabs.com
 *   2. Mint token Keycloak (client_credentials, scope daml_ledger_api)
 *      — secret dibaca dari apps/api/.env, TIDAK PERNAH dicetak.
 *   3. Probe Splice validator API (via Cloudflare) — endpoint versi.
 *   4. Probe TCP ledger API (162.250.191.195:443) — expect firewall.
 *
 * Jalankan: node apps/api/scripts/spike-net-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env loader (tanpa dependency) ────────────────────────────────────────
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}
const env = loadEnv(path.join(__dirname, '..', '.env'));

const KC_URL = env.KEYCLOAK_URL; // https://auth.canquestlabs.com
const KC_REALM = env.KEYCLOAK_REALM;
const KC_CID = env.LEDGER_CLIENT_ID;
const KC_SEC = env.LEDGER_CLIENT_SECRET;
const LEDGER_URL = env.LEDGER_API_URL; // https://ledger.canquestlabs.com
const VALIDATOR_URL = env.CANTON_VALIDATOR_URL; // https://validator.canquestlabs.com

// ── resolve record publik lewat DNS publik (bypass override LAN) ──────────
async function resolvePublicA(hostname) {
  const resolver = new dns.Resolver();
  for (const server of ['1.1.1.1', '8.8.8.8']) {
    try {
      resolver.setServers([server]);
      const addrs = await resolver.resolve4(hostname);
      if (addrs.length) return addrs[0];
    } catch {
      /* coba server berikutnya */
    }
  }
  throw new Error(`tidak bisa resolve A record publik untuk ${hostname}`);
}

function hostnameOf(u) {
  return new URL(u).hostname;
}

// HTTP(S) request dengan IP pinning + SNI asli. Body → string/Buffer.
function pinnedRequest(urlStr, { method = 'GET', headers = {}, body, ip, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        host: ip,
        port: 443,
        servername: u.hostname, // SNI + validasi sertifikat tetap benar
        path: u.pathname + u.search,
        method,
        headers: { ...headers, Host: u.hostname },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`timeout ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function tcpProbe(ip, port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (ok, why) => {
      s.destroy();
      resolve({ ok, why });
    };
    s.setTimeout(timeoutMs, () => done(false, `timeout ${timeoutMs}ms`));
    s.on('connect', () => done(true, 'connected'));
    s.on('error', (e) => done(false, e.message));
  });
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const results = [];

  // 1) Resolve record publik
  const hosts = {
    auth: hostnameOf(KC_URL),
    validator: hostnameOf(VALIDATOR_URL),
    ledger: hostnameOf(LEDGER_URL),
  };
  const pins = {};
  for (const [label, h] of Object.entries(hosts)) {
    try {
      pins[h] = await resolvePublicA(h);
      console.log(`[resolve] ${label} ${h} -> ${pins[h]}`);
    } catch (e) {
      console.log(`[resolve] ${label} ${h} -> GAGAL: ${e.message}`);
      results.push({ step: `resolve-${label}`, ok: false });
    }
  }

  // 2) Mint token Keycloak
  let token = null;
  try {
    const tokenUrl = `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: KC_CID,
      client_secret: KC_SEC,
      scope: env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api',
    }).toString();
    const res = await pinnedRequest(tokenUrl, {
      method: 'POST',
      ip: pins[hosts.auth],
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
    if (res.status === 200) {
      const json = JSON.parse(res.body.toString('utf8'));
      token = json.access_token;
      console.log(
        `[keycloak] token OK — expires_in=${json.expires_in}s panjang=${token.length} (nilai TIDAK dicetak)`,
      );
      // simpan di luar repo untuk langkah probe berikutnya
      const tmp = path.join(os.tmpdir(), 'canquest-spike-token.txt');
      fs.writeFileSync(tmp, token, { mode: 0o600 });
      console.log(`[keycloak] token disimpan sementara di ${tmp}`);
      results.push({ step: 'keycloak-token', ok: true });
    } else {
      console.log(`[keycloak] token GAGAL — HTTP ${res.status}: ${res.body.toString('utf8').slice(0, 200)}`);
      results.push({ step: 'keycloak-token', ok: false });
    }
  } catch (e) {
    console.log(`[keycloak] token GAGAL — ${e.message}`);
    results.push({ step: 'keycloak-token', ok: false });
  }

  // 3) Probe validator API (versi — biasanya tanpa auth)
  try {
    const vUrl = `${VALIDATOR_URL.replace(/\/$/, '')}/api/validator/v0/version`;
    const res = await pinnedRequest(vUrl, { ip: pins[hosts.validator] });
    console.log(
      `[validator] /api/validator/v0/version -> HTTP ${res.status} ${res.body.toString('utf8').slice(0, 120)}`,
    );
    results.push({ step: 'validator-version', ok: res.status < 500 });
  } catch (e) {
    console.log(`[validator] GAGAL — ${e.message}`);
    results.push({ step: 'validator-version', ok: false });
  }

  // 4) Probe TCP ledger API
  const ledgerIp = pins[hosts.ledger];
  if (ledgerIp) {
    const tcp = await tcpProbe(ledgerIp, 443);
    console.log(
      `[ledger] TCP ${ledgerIp}:443 -> ${tcp.ok ? 'OPEN' : `TERTUTUP (${tcp.why})`}`,
    );
    console.log(
      tcp.ok
        ? '[ledger] port terbuka — lanjut probe /livez & interactive-submission di langkah berikutnya'
        : '[ledger] port tertutup dari PC ini — perlu SSH tunnel / whitelist firewall VPS',
    );
    results.push({ step: 'ledger-tcp', ok: tcp.ok });
  }

  // Ringkasan
  console.log('\n== RINGKASAN ==');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? '\nSemua probe hijau — M0 bisa lanjut ke probe ledger API.'
      : `\n${failed} probe gagal — lihat baris FAIL di atas.`,
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
