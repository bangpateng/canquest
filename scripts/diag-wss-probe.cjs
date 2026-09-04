#!/usr/bin/env node
/**
 * Diagnostik WS probe: subscribe /v2/updates sebagai admin (mirror persis
 * CantonUpdatesService), stream beberapa detik, print histogram templateId
 * created + detail event yang mengandung 'TransferInstruction' / 'Holding'.
 * Jalankan DI VPS2: node diag-wss-probe.cjs [durasiDetik]
 */
const fs = require('fs');
const WebSocket = require('/var/www/canquest/apps/api/node_modules/ws');

function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

function collectEvents(update, acc) {
  const u = update;
  // flat events
  for (const ev of u.events || []) {
    const variant = ev;
    if (variant.created) acc.push({ kind: 'created', ...variant.created });
    else if (variant.CreatedEvent) acc.push({ kind: 'created', ...variant.CreatedEvent });
    else if (variant.archived) acc.push({ kind: 'archived', ...variant.archived });
    else if (variant.ArchivedEvent) acc.push({ kind: 'archived', ...variant.ArchivedEvent });
    else if (variant.exercised) acc.push({ kind: 'exercised', ...variant.exercised });
    else if (variant.ExercisedEvent) acc.push({ kind: 'exercised', ...variant.ExercisedEvent });
  }
  // tree map
  if (u.eventsById && typeof u.eventsById === 'object') {
    for (const wrap of Object.values(u.eventsById)) {
      if (wrap.CreatedEvent) acc.push({ kind: 'created', ...wrap.CreatedEvent });
      else if (wrap.ArchivedEvent) acc.push({ kind: 'archived', ...wrap.ArchivedEvent });
      else if (wrap.ExercisedEvent) acc.push({ kind: 'exercised', ...wrap.ExercisedEvent });
    }
  }
}

(async () => {
  const durSec = Number(process.argv[2] || 25);
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = 'http://127.0.0.1:7575';
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
  if (!tok.access_token) {
    console.error('token fail');
    process.exit(1);
  }
  const end = await (
    await fetch(`${base}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
  ).json();
  console.error(`ledgerEnd offset=${end.offset}`);

  const ws = new WebSocket('ws://127.0.0.1:7575/v2/updates', ['daml.ws.auth'], {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const templateCount = new Map();
  let updates = 0;
  const interesting = [];

  ws.on('open', () => {
    console.error('WS open — subscribing (LEDGER_EFFECTS, wildcard)...');
    ws.send(
      JSON.stringify({
        beginExclusive: Number(end.offset),
        updateFormat: {
          includeTransactions: {
            eventFormat: {
              filtersForAnyParty: {
                cumulative: [
                  { identifierFilter: { WildcardFilter: { value: {} } } },
                ],
              },
              verbose: true,
            },
            transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          },
        },
      }),
    );
  });
  ws.on('message', (data) => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    // unwrap (mirror service)
    let update = null;
    if (raw.events || raw.updateId) update = raw;
    else if (raw.update?.Transaction?.value) update = raw.update.Transaction.value;
    if (!update) return;
    updates++;
    const acc = [];
    collectEvents(update, acc);
    for (const e of acc) {
      const key = `${e.kind}:${e.templateId}`;
      templateCount.set(key, (templateCount.get(key) ?? 0) + 1);
      if (
        String(e.templateId || '').includes('TransferInstruction') ||
        String(e.templateId || '').includes('Holding')
      ) {
        interesting.push({
          updateId: update.updateId,
          kind: e.kind,
          templateId: e.templateId,
          choice: e.choice,
          cid: e.contractId,
          argKeys: e.createArgument ? Object.keys(e.createArgument) : undefined,
          witnesses: (e.witnessParties || []).map((p) => p.split('::')[0]),
        });
      }
    }
  });
  ws.on('error', (e) => console.error('WS error:', e.message));
  ws.on('close', (c, r) => console.error('WS close:', c, String(r).slice(0, 100)));

  setTimeout(() => {
    ws.close();
    console.log('=== UPDATES:', updates);
    console.log('=== TEMPLATE HISTOGRAM (sorted) ===');
    for (const [k, v] of [...templateCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(String(v).padStart(4), k);
    }
    console.log('=== TRANSFER-INSTRUCTION / HOLDING EVENTS ===');
    console.log(JSON.stringify(interesting.slice(0, 20), null, 1));
    process.exit(0);
  }, durSec * 1000);
})().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
