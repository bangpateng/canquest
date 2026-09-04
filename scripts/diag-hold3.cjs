#!/usr/bin/env node
const fs = require('fs');
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
  const base = env.LEDGER_API_URL.replace(/\/$/, '');
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
  const party =
    'canquest-user-24c9b39bd350::12201478ef10af469c13b9671ec5047967198d1441f484b8df832260b1d92efbb317';
  const end = await (
    await fetch(`${base}/v2/state/ledger-end`, { headers: auth })
  ).json();
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
      },
      activeAtOffset: Number(end.offset),
    }),
  });
  const rows = await res.json();
  let n = 0;
  for (const entry of Array.isArray(rows) ? rows : []) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    const tpl = String(ev.templateId || '');
    if (tpl.indexOf('Holding') !== -1 && tpl.indexOf('Amulet') === -1 && n < 2) {
      console.log('=== templateId:', tpl);
      console.log(JSON.stringify(ev.createArgument, null, 1).slice(0, 1500));
      n++;
    }
  }
  if (n === 0) console.log('NO HOLDING FOUND');
})().catch((e) => console.error('fatal', e));
