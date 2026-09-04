#!/usr/bin/env node
/**
 * Monitor ACS party-scoped (insiden 2026-09-05) — baca-saja terhadap node,
 * hasil dicatat ke tabel AcsHealthCheck setiap 5 menit: per party aktif +
 * varian wildcard ('*'). Deteksi pemulihan: baris > 0 kembali.
 * Jalankan DI VPS2 via pm2: name acs-health-monitor.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const INTERVAL_MS = 5 * 60_000;

function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

(async () => {
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = (env.LEDGER_API_URL || '').replace(/\/$/, '');
  const getToken = async () => {
    const r = await fetch(
      `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: env.LEDGER_CLIENT_ID,
          client_secret: env.LEDGER_CLIENT_SECRET,
          scope: 'daml_ledger_api',
        }),
      },
    );
    return (await r.json()).access_token;
  };

  const users = await prisma.user.findMany({
    where: { cantonPartyId: { not: null } },
    select: { cantonPartyId: true },
  });
  const parties = users
    .map((u) => u.cantonPartyId)
    .filter((p) => p && !p.startsWith('canquest:'));

  async function cycle() {
    let token = await getToken();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const endRes = await fetch(`${base}/v2/state/ledger-end`, { headers: auth });
    const ledgerEnd = Number((await endRes.json()).offset ?? 0);
    let okCount = 0;
    const targets = [...parties.map((p) => ({ party: p, wildcard: false })), { party: '*', wildcard: true }];
    for (const t of targets) {
      const body = t.wildcard
        ? { eventFormat: { filtersForAnyParty: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] }, verbose: false } }
        : { eventFormat: { filtersByParty: { [t.party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } }, verbose: false } };
      let status = 0;
      let rows = -1;
      try {
        const res = await fetch(`${base}/v2/state/active-contracts`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify(body),
        });
        status = res.status;
        const arr = res.ok ? await res.json() : [];
        rows = Array.isArray(arr) ? arr.length : -1;
      } catch (e) {
        status = -1;
      }
      if (rows > 0) okCount++;
      await prisma.acsHealthCheck.create({
        data: {
          party: t.wildcard ? '*' : t.party,
          httpStatus: status,
          rows,
          ledgerEnd: BigInt(ledgerEnd),
        },
      });
    }
    console.log(
      `[acs-monitor] ${new Date().toISOString()} ledgerEnd=${ledgerEnd} targetOK=${okCount}/${targets.length}`,
    );
  }

  await cycle();
  setInterval(() => {
    void cycle().catch((e) => console.error('[acs-monitor] cycle error:', String(e).slice(0, 200)));
  }, INTERVAL_MS);
})().catch((e) => {
  console.error('[acs-monitor] FATAL', String(e));
  process.exit(1);
});
