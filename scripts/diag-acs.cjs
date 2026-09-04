#!/usr/bin/env node
/** Diagnostik ACS receiver (mirror queryPendingOffers: eventFormat + activeAtOffset). */
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
  const base = 'https://ledger.canquestlabs.com';
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
  console.log('ledgerEnd:', end.offset);

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
      activeAtOffset: Number(end.offset),
    }),
  });
  console.log('ACS status:', res.status);
  const data = await res.json();
  const rows = (Array.isArray(data) ? data : []).map((r) => {
    const ev = r?.contractEntry?.JsActiveContract?.createdEvent ?? r;
    return {
      template: ev.templateId,
      cid: String(ev.contractId || '').slice(0, 20),
      argKeys: Object.keys(ev.createArgument || {}),
    };
  });
  const byTemplate = {};
  for (const r of rows) byTemplate[r.template] = (byTemplate[r.template] || 0) + 1;
  console.log('total:', rows.length);
  console.log(JSON.stringify(byTemplate, null, 1));
})().catch((e) => console.error('fatal', e));
