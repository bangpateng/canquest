#!/usr/bin/env node
/** Diagnostik: bandingkan deliverability LEDGER_EFFECTS vs LEDGER_UPDATE (backlog end-30). */
const fs = require('fs');
const WebSocket = require('/var/www/canquest/node_modules/ws');
function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}
async function getToken(env) {
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
}
function run(label, shape, base, token, beginExclusive, durMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${base}/v2/updates`, ['daml.ws.auth'], {
      headers: { Authorization: `Bearer ${token}` },
    });
    let msgs = 0,
      checkpoints = 0,
      txs = 0,
      txSample = null;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          beginExclusive,
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
            transactionShape: shape,
          },
        },
        }),
      );
    });
    ws.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      msgs++;
      try {
        const raw = JSON.parse(text);
        if (raw.update?.OffsetCheckpoint) checkpoints++;
        else if (raw.updateId || raw.update?.Transaction || raw.events) {
          txs++;
          if (!txSample) txSample = text.slice(0, 200);
        }
      } catch {}
    });
    ws.on('close', (c) => {
      console.log(`${label}: closed code=${c}`);
      resolve();
    });
    ws.on('error', (e) => console.log(`${label}: error ${e.message}`));
    setTimeout(() => {
      console.log(
        `${label}: msgs=${msgs} checkpoints=${checkpoints} transactions=${txs}`,
      );
      if (txSample) console.log(`${label} sample: ${txSample}`);
      try {
        ws.close();
      } catch {}
      resolve();
    }, durMs);
  });
}
(async () => {
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = 'wss://ledger.canquestlabs.com/v2/updates';
  const restBase = 'https://ledger.canquestlabs.com';
  const token = await getToken(env);
  const end = await (
    await fetch(`${restBase}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const begin = Number(end.offset) - 30;
  console.log(`ledgerEnd=${end.offset} beginExclusive=${begin}`);
  await run('LEDGER_EFFECTS', 'TRANSACTION_SHAPE_LEDGER_EFFECTS', base, token, begin, 30_000);
  await run('LEDGER_UPDATE ', 'TRANSACTION_SHAPE_LEDGER_UPDATE', base, token, begin, 30_000);
  process.exit(0);
})().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
