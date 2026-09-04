#!/usr/bin/env node
/**
 * L5.0 (S3) — ambil snapshot ACS pada offset TITIK NOL (819747) untuk SEMUA
 * party yang dikenal DB (aktif + legacy; superset 9 party), plus
 * firstSeenOffset per party via /v2/updates/flats. Tulis hasilnya ke tabel
 * AcsOpeningBalance (satu baris per party) — persist, bukan output terminal.
 *
 * Sumber party: DB (User.cantonPartyId + User.legacyPartyId) — bukan hardcode.
 * Jalankan DI VPS2: cd /var/www/canquest && node scripts/take-acs-opening-snapshot.cjs
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const AT_OFFSET = 819747;

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
  const auth = {
    Authorization: `Bearer ${tok.access_token}`,
    'Content-Type': 'application/json',
  };

  // ── Daftar party dari DB (aktif + legacy) ───────────────────────────────
  const users = await prisma.user.findMany({
    select: { username: true, cantonPartyId: true, legacyPartyId: true },
  });
  const targets = new Map(); // party → label
  for (const u of users) {
    if (u.cantonPartyId) targets.set(u.cantonPartyId, `AKTIF:${u.username}`);
    if (u.legacyPartyId) targets.set(u.legacyPartyId, `LEGACY:${u.username}`);
  }
  console.log(
    `party dari DB: ${targets.size} (${[...targets.values()].filter((v) => v.startsWith('AKTIF')).length} aktif, ${[...targets.values()].filter((v) => v.startsWith('LEGACY')).length} legacy)`,
  );

  const report = [];
  for (const [party, label] of targets) {
    // ── ACS pada 819747 ──────────────────────────────────────────────────
    const res = await fetch(`${base}/v2/state/active-contracts`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        eventFormat: {
          filtersByParty: {
            [party]: {
              cumulative: [
                {
                  identifierFilter: {
                    WildcardFilter: { value: { includeCreatedEventBlob: false } },
                  },
                },
              ],
            },
          },
          verbose: true,
        },
        activeAtOffset: AT_OFFSET,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const rows = res.ok ? await res.json() : [];
    const holdings = [];
    const sums = {}; // `${admin}|${id}` → number
    for (const entry of Array.isArray(rows) ? rows : []) {
      const ev =
        entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry ?? {};
      const tpl = String(ev.templateId || '');
      const args = ev.createArgument ?? {};
      const owner = typeof args.owner === 'string' ? args.owner : null;
      if (owner && owner !== party) continue; // holding milik party lain (hanya di-witness)
      const isAmulet = tpl.includes('Splice.Amulet:Amulet');
      const isHolding = tpl.endsWith('Holding:Holding');
      if (!isAmulet && !isHolding) continue;
      const instId = isAmulet ? 'Amulet' : (args.instrument?.id ?? args.instrumentId?.id ?? args.label ?? '?');
      const instAdmin = isAmulet
        ? (args.instrument?.admin ?? args.instrumentId?.admin ?? 'DSO')
        : (args.instrument?.admin ?? args.instrument?.source ?? args.instrumentId?.admin ?? args.registrar ?? '?');
      const amt = parseFloat(
        args.amount?.initialAmount ?? args.amount?.amount ?? args.amount ?? '0',
      );
      holdings.push({
        contractId: ev.contractId,
        template: tpl.split(':').slice(-2).join(':'),
        instrumentId: instId,
        instrumentAdmin: instAdmin,
        amount: Number.isFinite(amt) ? amt : null,
      });
      const key = `${instAdmin}|${instId}`;
      sums[key] = (sums[key] ?? 0) + (Number.isFinite(amt) ? amt : 0);
    }

    // ── firstSeenOffset via flats (offset transaksi pertama sejak 819747) ──
    let firstSeenOffset = null;
    // endInclusive WAJIB <= ledger-end aktual — nilai melewati head ditolak
    // node (dan kegagalan ini pernah tertelan senyap: jangan ulangi).
    const lend = (
      await (await fetch(`${base}/v2/state/ledger-end`, { headers: auth })).json()
    ).offset;
    const fr = await fetch(`${base}/v2/updates/flats`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        updateFormat: {
          includeTransactions: {
            eventFormat: {
              filtersByParty: {
                [party]: {
                  cumulative: [
                    {
                      identifierFilter: {
                        WildcardFilter: { value: { includeCreatedEventBlob: false } },
                      },
                    },
                  ],
                },
              },
              verbose: false,
            },
            transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          },
        },
        beginExclusive: AT_OFFSET,
        endInclusive: Number(lend),
        verbose: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!fr.ok) {
      console.log(`  [firstSeen] flats GAGAL http=${fr.status}: ${(await fr.text()).slice(0, 150)}`);
    } else {
      const arr = await fr.json();
      const offsets = arr
        .map((x) => x?.update?.Transaction?.value?.offset)
        .filter((o) => Number.isFinite(o));
      if (offsets.length > 0) firstSeenOffset = Math.min(...offsets);
    }

    const born = holdings.length > 0 || (firstSeenOffset !== null && firstSeenOffset <= AT_OFFSET)
      ? 'SEBELUM-819747'
      : firstSeenOffset !== null
        ? `sesudah (firstSeen=${firstSeenOffset})`
        : 'tidak pernah terlihat';

    // ── Persist ───────────────────────────────────────────────────────────
    await prisma.acsOpeningBalance.upsert({
      where: { partyId: party },
      create: {
        partyId: party,
        atOffset: BigInt(AT_OFFSET),
        firstSeenOffset: firstSeenOffset !== null ? BigInt(firstSeenOffset) : null,
        holdings,
        sums,
      },
      update: {
        takenAt: new Date(),
        firstSeenOffset: firstSeenOffset !== null ? BigInt(firstSeenOffset) : null,
        holdings,
        sums,
      },
    });
    report.push({ label, party: party.slice(0, 28), holdingsN: holdings.length, sums, firstSeenOffset, born });
    console.log(
      `${label.padEnd(22)} holdings@819747=${holdings.length} firstSeen=${firstSeenOffset ?? '-'} → ${born}`,
    );
  }

  console.log('\n— ringkas —');
  const before = report.filter((r) => r.born === 'SEBELUM-819747');
  console.log(
    `lahir SEBELUM 819747: ${before.length} → rekonsiliasi L9 BUTUH saldo pembuka`,
  );
  console.log(
    `lahir SESUDAH / tak terlihat: ${report.length - before.length} → pembuka nol`,
  );
  await prisma.$disconnect();
})().catch((e) => {
  console.error('SNAPSHOT_ERROR', String(e));
  process.exit(1);
});
