#!/usr/bin/env node
/**
 * Paket verifikasi temuan insiden ACS (2026-09-05) — READ-ONLY, dapat
 * dijalankan siapa pun dengan akses ke node (dari VPS2):
 *   cd /var/www/canquest && node scripts/acs-page-verify.cjs
 *
 * Menghasilkan tiga bukti yang dapat direproduksi:
 *   [1] Endpoint NON-paginasi mengembalikan array kosong (gejala insiden),
 *       sementara endpoint PAGINASI mengembalikan kontrak aktif nyata.
 *   [2] Data endpoint paginasi CURRENT (bukan snapshot beku): memuat holding
 *       yang lahir SETELAH onset insiden (2×1,0 CC ke party amel, 4 Sep ~22:1x UTC).
 *   [3] Data endpoint paginasi BENAR membanding holding kedaluwarsa:
 *       tiga holding kecil-berumur terlihat di stream historis tapi tidak
 *       disajikan ACS-page (konsumsi/expiry yang tidak disaksikan participant —
 *       privasi Canton). Detail tiap kontrak dicetak.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

const AMEL = 'canquest-user-9bd3d1a7820c::1220d2d3f8c8a2f2e2e9e7b8af6900f62c6210c7e3905ba40b7afa34678b695cdfc6';
const JUTKAN = 'canquest-user-24c9b39bd350::12201478ef10af469c13b9671ec5047967198d1441f484b8df832260b1d92efbb317';

async function acsPage(auth, base, party, opts = {}) {
  const wf = {
    filtersByParty: {
      [party]: {
        cumulative: [
          { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
        ],
      },
    },
    verbose: false,
  };
  let body = { eventFormat: wf, maxPageSize: 500, ...opts };
  let r = await fetch(base + '/v2/state/active-contracts-page', {
    method: 'POST', headers: auth, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`acs-page ${r.status}: ${(await r.text()).slice(0, 150)}`);
  let j = await r.json();
  const rows = j.activeContracts ?? [];
  let guard = 0;
  while (j.nextPageToken && guard++ < 30) {
    r = await fetch(base + '/v2/state/active-contracts-page', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ eventFormat: wf, maxPageSize: 500, ...opts, pageToken: j.nextPageToken }),
    });
    if (!r.ok) break;
    j = await r.json();
    rows.push(...(j.activeContracts ?? []));
  }
  return { rows, activeAtOffset: j.activeAtOffset };
}

const sumAmulet = (rows, party) => {
  let cc = 0;
  const cids = [];
  for (const row of rows) {
    const ev = row?.contractEntry?.JsActiveContract?.createdEvent ?? {};
    const tpl = String(ev.templateId || '');
    const a = ev.createArgument ?? {};
    if (!tpl.includes('Splice.Amulet:Amulet') && !tpl.includes('LockedAmulet')) continue;
    if (a.owner && a.owner !== party) continue;
    cc += parseFloat(a.amount?.initialAmount ?? '0') || 0;
    cids.push(ev.contractId);
  }
  return { cc, cids };
};

(async () => {
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = (env.LEDGER_API_URL || '').replace(/\/$/, '');
  const tok = await (
    await fetch(
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
    )
  ).json();
  const auth = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  console.log('=== [1] NON-PAGINASI vs PAGINASI (filter identik, party amel) ===');
  const wfFlat = {
    filtersByParty: {
      [AMEL]: {
        cumulative: [
          { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
        ],
      },
    },
    verbose: false,
  };
  const rFlat = await fetch(base + '/v2/state/active-contracts', {
    method: 'POST', headers: auth, body: JSON.stringify({ eventFormat: wfFlat }),
  });
  const flat = rFlat.ok ? await rFlat.json() : null;
  console.log(`  active-contracts       → HTTP ${rFlat.status}, items=${Array.isArray(flat) ? flat.length : '?'}`);
  const page = await acsPage(auth, base, AMEL);
  console.log(`  active-contracts-page  → HTTP 200, items=${page.rows.length} (activeAtOffset=${page.activeAtOffset})`);

  console.log('\n=== [2] PAGINASI = CURRENT (holding pasca-onset ada?) ===');
  const { cc: amelCc } = sumAmulet(page.rows, AMEL);
  console.log(`  amel CC menurut ACS-page@head = ${amelCc.toFixed(6)}`);
  console.log(`  → CURRENT bila ≈ 40.536575 (termasuk 2×1.0 CC yang diterima SETELAH onset 4 Sep ~22:15 UTC).`);
  console.log(`  → BEKU bila ≈ 38.536575 (nilai pra-onset).`);

  console.log('\n=== [3] HOLDING TERLIHAT-DI-STREAM tapi TIDAK-DI-ACS (party jutkan) ===');
  const pageJ = await acsPage(auth, base, JUTKAN);
  const { cc: jutCc, cids: pageCids } = sumAmulet(pageJ.rows, JUTKAN);
  console.log(`  jutkan CC ACS-page = ${jutCc.toFixed(6)}`);
  const created = await prisma.ledgerEvent.findMany({
    where: { eventType: 'created', templateId: { contains: 'Splice.Amulet:Amulet' } },
    select: { recordTime: true, contractId: true, payload: true },
  });
  const archived = new Set(
    (await prisma.ledgerEvent.findMany({
      where: { eventType: 'exercised', choice: 'Archive' }, select: { contractId: true },
    })).map((a) => a.contractId),
  );
  for (const c of created) {
    if (archived.has(c.contractId)) continue;
    if (c.payload?.createArgument?.owner !== JUTKAN) continue;
    if (pageCids.includes(c.contractId)) continue;
    console.log(
      `  TIDAK-DI-ACS: cid=${c.contractId.slice(0, 16)}… amt=${c.payload.createArgument.amount?.initialAmount} dibuat=${c.recordTime.toISOString()} (tidak pernah di-archive di stream kita — konsumsi tak terlihat)`,
    );
  }
  console.log('\nSelesai. Semua permintaan di atas bersifat baca-saja.');
  await prisma.$disconnect();
})().catch((e) => {
  console.error('VERIFY_ERROR', String(e));
  process.exit(1);
});
