#!/usr/bin/env node
/**
 * Diagnostik: fetch transaction events by updateId via /v2/updates/transactions
 * untuk melihat bentuk event nyata (template created) dari transaksi accept
 * offer USDCx. Jalankan DI VPS2 (node scripts/diag-wss-event.cjs <updateId>).
 */
const fs = require('fs');

function envFrom(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const updateId = process.argv[2];
  if (!updateId) {
    console.error('usage: node diag-wss-event.cjs <updateId>');
    process.exit(1);
  }
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = 'http://127.0.0.1:7575';

  // 1. Admin token (client_credentials)
  const tokRes = await fetch(
    `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.LEDGER_CLIENT_ID,
        client_secret: env.LEDGER_CLIENT_SECRET,
        // audience harus cocok LEDGER_API_AUTH_AUDIENCE kalau diset
        ...(env.LEDGER_API_AUTH_AUDIENCE
          ? { audience: env.LEDGER_API_AUTH_AUDIENCE }
          : {}),
      }),
    },
  );
  if (!tokRes.ok) {
    console.error('token failed', tokRes.status, await tokRes.text());
    process.exit(1);
  }
  const { access_token } = await tokRes.json();

  // 2. ledgerEnd untuk anchor scan window
  const endRes = await fetch(`${base}/v2/state/ledger-end`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const end = await endRes.json();
  const endNum = Number(end.offset);
  console.error(`ledgerEnd=${endNum}`);

  // 3. Scan updates (window 400) — filter by receiver party (stakeholder)
  const party =
    process.argv[3] ||
    'canquest-user-24c9b39bd350::12201478ef10af469c13b9671ec5047967198d1441f484b8df832260b1d92efbb317';
  const res = await fetch(`${base}/v2/updates/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { filtersByParty: { [party]: {} } },
      beginExclusive: endNum - 400,
    }),
  });
  if (!res.ok) {
    console.error('updates failed', res.status, (await res.text()).slice(0, 300));
    process.exit(1);
  }
  const data = await res.json();
  const txs = data.transactions || [];
  console.error(`scanned ${txs.length} updates`);
  const tx = txs.find((t) => (t.updateId || '').startsWith(updateId));
  if (!tx) {
    console.error('updateId NOT found in window. updateIds seen:');
    for (const t of txs.slice(-10)) console.error(' ', t.updateId?.slice(0, 20));
    process.exit(2);
  }
  // Print ringkas: setiap event → kind + templateId + keys createArgument
  const out = [];
  const walk = (ev) => {
    if (ev.created) {
      out.push({
        kind: 'created',
        templateId: ev.created.templateId,
        cid: ev.created.contractId,
        argKeys: Object.keys(ev.created.createArgument || {}),
        witness: ev.created.witnessParties,
      });
    } else if (ev.archived) {
      out.push({ kind: 'archived', templateId: ev.archived.templateId });
    } else if (ev.exercised) {
      out.push({
        kind: 'exercised',
        templateId: ev.exercised.templateId,
        choice: ev.exercised.choice,
      });
    }
  };
  for (const ev of tx.events || []) walk(ev);
  // tree map kalau ada
  if (tx.eventsById) {
    for (const [nodeId, wrap] of Object.entries(tx.eventsById)) {
      const inner = wrap.CreatedEvent || wrap.ArchivedEvent || wrap.ExercisedEvent;
      if (inner)
        out.push({ node: nodeId, kind: Object.keys(wrap)[0], templateId: inner.templateId, choice: inner.choice });
    }
  }
  console.log(JSON.stringify({ updateId: tx.updateId, offset: tx.offset, events: out }, null, 1));
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
