#!/usr/bin/env node
/**
 * L5.0 probe (b) — read-only. Uji hipotesis: kegagalan parser
 * (404 NO_TEMPLATES_FOR_PACKAGE_NAME) berasal dari isMasterUser=true yang
 * membuat callback /v2/events/events-by-contract-id memakai filtersForAnyParty.
 * Varian ini memakai isMasterUser=FALSE (parser mode per-party → filtersByParty)
 * atas transaksi nyata yang sama (jutkan, jendela tadi malam).
 * Provider mencatat SETIAP callback yang dikirim parser — bentuk filternya
 * terlihat, bukan tebakan.
 */
const fs = require('fs');
const {
  TransactionParser,
  renderTransaction,
} = require('@canton-network/core-tx-parser');

const IFACES = [
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
  '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory',
  '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationInstruction',
  '#splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
  '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation',
];

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

  let callbackCount = 0;
  const callbackLog = [];
  const ledgerProvider = {
    async request({ params }) {
      const { resource, requestMethod, body } = params;
      callbackCount++;
      const usesAnyParty =
        body?.eventFormat && 'filtersForAnyParty' in body.eventFormat;
      const parties = body?.eventFormat?.filtersByParty
        ? Object.keys(body.eventFormat.filtersByParty)
        : [];
      callbackLog.push({
        resource,
        anyParty: usesAnyParty,
        parties: parties.slice(0, 1),
        nIfaces:
          body?.eventFormat?.filtersForAnyParty?.cumulative?.length ??
          parties[0]
            ? (body?.eventFormat?.filtersByParty?.[parties[0]]?.cumulative || [])
                .length
            : 0,
      });
      const res = await fetch(base + resource, {
        method: (requestMethod || 'post').toUpperCase(),
        headers: auth,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(
          `ledgerApi ${resource} ${res.status}: ${text.slice(0, 160)}`,
        );
        err.status = res.status;
        throw err;
      }
      return JSON.parse(text);
    },
  };

  const PARTY =
    'canquest-user-24c9b39bd350::12201478ef10af469c13b9671ec5047967198d1441f484b8df832260b1d92efbb317'; // jutkan (dari DB)

  // Ambil 8 transaksi nyata jutkan via flats — filter SDK persis (views included).
  const end = (
    await (await fetch(`${base}/v2/state/ledger-end`, { headers: auth })).json()
  ).offset;
  const cumulative = [
    ...IFACES.map((i) => ({
      identifierFilter: {
        InterfaceFilter: {
          value: {
            interfaceId: i,
            includeInterfaceView: true,
            includeCreatedEventBlob: false,
          },
        },
      },
    })),
    {
      identifierFilter: {
        WildcardFilter: { value: { includeCreatedEventBlob: false } },
      },
    },
  ];
  const fr = await fetch(`${base}/v2/updates/flats`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      updateFormat: {
        includeTransactions: {
          eventFormat: { filtersByParty: { [PARTY]: { cumulative } }, verbose: false },
          transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
        },
      },
      beginExclusive: 2180000,
      endInclusive: end,
      verbose: false,
    }),
  });
  const arr = fr.ok ? await fr.json() : [];
  const txs = arr
    .map((x) => x?.update?.Transaction?.value)
    .filter(Boolean);
  console.log(`[b] transaksi nyata jutkan: ${txs.length} (offset ${Math.min(...txs.map((t) => t.offset))}..${Math.max(...txs.map((t) => t.offset))})`);

  let ok = 0;
  let okWithEvents = 0;
  let err = 0;
  let sample = null;
  for (const tx of txs) {
    try {
      const parsed = await new TransactionParser(
        ledgerProvider,
        tx,
        PARTY,
        false, // ← (b): isMasterUser=FALSE → callback pakai filtersByParty
      ).parseTransaction();
      ok++;
      if (parsed.events.length > 0) {
        okWithEvents++;
        if (!sample) sample = parsed;
      }
    } catch (e) {
      err++;
      console.log(
        `[b] ERROR updateId=${tx.updateId?.slice(0, 16)}…: ${String(e).slice(0, 180)}`,
      );
    }
  }
  console.log(
    `[b] HASIL: ok=${ok} (dgn event=${okWithEvents}) error=${err} — callback ke ledger: ${callbackCount} kali`,
  );
  console.log(
    `[b] bentuk callback (maks 3): ${JSON.stringify(callbackLog.slice(0, 3))}`,
  );
  if (sample) {
    const rendered = renderTransaction(sample);
    console.log(
      `[b] SAMPLE: ${JSON.stringify(rendered).slice(0, 500)}`,
    );
  }
  console.log(
    err === 0
      ? '[b] VERDICT HIJAU — isMasterUser=false menghilangkan NO_TEMPLATES. Fallback ledger tetap berguna utk edge.'
      : '[b] VERDICT MERAH — masih error; jalur utama = raw-layer callback (opsi a).',
  );
})().catch((e) => {
  console.error('PROBE_ERROR', String(e));
  process.exit(1);
});
