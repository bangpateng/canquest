#!/usr/bin/env node
/**
 * L5.0 SMOKE TEST (read-only) — go/no-go sebelum backfill L5.
 *
 * Membuktikan dua hal di jalur WS /v2/updates (TRANSACTION_SHAPE_LEDGER_EFFECTS)
 * dengan filter PERSIS yang akan dipakai L5 (7 InterfaceFilter token-standard
 * + wildcard, verbose, includeInterfaceView):
 *   A. Jendela yang dipetik berisi TRANSFER NYATA (bukan rentang sepi) —
 *      offset transfer ditemukan dulu via /v2/updates/flats untuk party nyata.
 *   B. interfaceViews HADIR pada event created di jalur WS, dan parser resmi
 *      (core-tx-parser TransactionParser + renderTransaction) berhasil
 *      menghasilkan holdings change per instrumen dari hasil tangkapan.
 *
 * Jalankan DI VPS2 via stdin (tanpa menulis file):
 *   ssh vps2 'cd /var/www/canquest && node -' < scripts/l50-smoke.cjs
 */
const fs = require('fs');
const WebSocket = require('ws');
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
  const ledgerProvider = {
    async request({ params }) {
      const { resource, requestMethod, body } = params;
      const res = await fetch(base + resource, {
        method: (requestMethod || 'post').toUpperCase(),
        headers: auth,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(
          `ledgerApi ${resource} ${res.status}: ${text.slice(0, 200)}`,
        );
        err.status = res.status;
        throw err;
      }
      return JSON.parse(text);
    },
  };

  const PARTY =
    'canquest-user-24c9b39bd350::12201478ef10af469c13b9671ec5047967198d1441f484b8df832260b1d92efbb317'; // jutkan — dari DB (audit L1.5)

  // ── A. Temukan offset transfer NYATA via flats ─────────────────────────
  const end = (await (await fetch(`${base}/v2/state/ledger-end`, { headers: auth })).json()).offset;
  console.log(`[A] ledger-end=${end}`);
  const cumulative = [
    ...IFACES.map((i) => ({
      identifierFilter: {
        InterfaceFilter: {
          value: { interfaceId: i, includeInterfaceView: true, includeCreatedEventBlob: false },
        },
      },
    })),
    { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
  ];
  const flatsBody = {
    updateFormat: {
      includeTransactions: {
        eventFormat: { filtersByParty: { [PARTY]: { cumulative } }, verbose: false },
        transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
      },
    },
    beginExclusive: 2180000,
    endInclusive: end,
    verbose: false,
  };
  const flatsRes = await fetch(`${base}/v2/updates/flats`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(flatsBody),
  });
  const flatsArr = flatsRes.ok ? await flatsRes.json() : [];
  const realTx = flatsArr
    .map((x) => x?.update?.Transaction?.value)
    .filter(Boolean)
    .map((v) => ({ updateId: v.updateId, offset: v.offset, events: (v.events || []).length }));
  console.log(
    `[A] flats window 2180000..${end}: ${realTx.length} transaksi nyata utk party jutkan` +
      (realTx.length
        ? ` — offset ${Math.min(...realTx.map((t) => t.offset))}..${Math.max(...realTx.map((t) => t.offset))}`
        : ''),
  );
  if (realTx.length === 0) {
    console.log('[A] GAGAL: tidak menemukan transfer nyata — perlu jendela lain. BERHENTI.');
    process.exit(1);
  }
  const minReal = Math.min(...realTx.map((t) => t.offset));
  const beginExclusive = Math.max(819747, minReal - 2000);
  console.log(`[A] jendela smoke dipilih: beginExclusive=${beginExclusive} (minReal=${minReal})`);

  // ── B. Tangkap jendela via WS dengan filter persis L5 ──────────────────
  const wsUrl = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/v2/updates';
  const ws = new WebSocket(wsUrl, ['daml.ws.auth'], { headers: auth });
  const captured = []; // {offset, txValue}
  let firstOff = null;
  let lastOff = null;
  const stats = { msgs: 0, created: 0, createdWithViews: 0, exercised: 0, archived: 0, tpl: {}, tplViews: {} };
  const done = () => Math.max(0, (lastOff ?? 0) - (firstOff ?? 0)) >= 10_000;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log('[B] TIMEOUT 45s');
      resolve();
    }, 45_000);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          beginExclusive,
          updateFormat: {
            includeTransactions: {
              eventFormat: { filtersForAnyParty: { cumulative }, verbose: true },
              transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
            },
          },
        }),
      );
    });
    ws.on('message', (d) => {
      let j = null;
      try {
        j = JSON.parse(d.toString());
      } catch {
        return;
      }
      stats.msgs++;
      const tx = j?.update?.Transaction?.value;
      if (!tx) return;
      const off = Number(tx.offset);
      if (firstOff === null) firstOff = off;
      lastOff = off;
      captured.push(tx);
      for (const ev of tx.events || []) {
        const inner = Object.values(ev)[0];
        if (!inner) continue;
        const tplKey = String(inner.templateId || '?').split(':').slice(-2).join(':');
        const hasViews = Array.isArray(inner.interfaceViews) && inner.interfaceViews.length > 0;
        if ('CreatedEvent' in ev || ev.created) {
          stats.created++;
          if (hasViews) {
            stats.createdWithViews++;
            stats.tplViews[tplKey] = (stats.tplViews[tplKey] || 0) + 1;
          }
        } else if ('ArchivedEvent' in ev || ev.archived) stats.archived++;
        else stats.exercised++;
        stats.tpl[tplKey] = (stats.tpl[tplKey] || 0) + 1;
      }
      if (done()) {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (e) => {
      console.log('[B] WS ERROR', String(e).slice(0, 200));
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    ws.close(1000);
  } catch {}
  console.log(
    `[B] tertangkap ${captured.length} transaksi, span offset ${firstOff}..${lastOff} (${(lastOff ?? 0) - (firstOff ?? 0)}), msgs=${stats.msgs}`,
  );
  console.log(
    `[B] event: created=${stats.created} (dgn interfaceViews=${stats.createdWithViews}) archived=${stats.archived} exercised=${stats.exercised}`,
  );
  console.log(`[B] template hist: ${JSON.stringify(stats.tpl)}`);
  console.log(`[B] created dgn views per template: ${JSON.stringify(stats.tplViews)}`);

  const amuletTpl = 'Splice.Amulet:Amulet';
  const holdingTpl = 'Utility.Registry.Holding.V0.Holding:Holding';
  const amuletViews = stats.tplViews[amuletTpl] || 0;
  const holdingViews = stats.tplViews[holdingTpl] || 0;
  console.log(
    `[VERDICT-1] interfaceViews di jalur WS: Amulet ${amuletViews}/${stats.tpl[amuletTpl] || 0}, Holding ${holdingViews}/${stats.tpl[holdingTpl] || 0}`,
  );

  // ── C. Parser resmi atas hasil tangkapan ───────────────────────────────
  let parsedOk = 0;
  let parsedErr = 0;
  let totalEvents = 0;
  let samplePrinted = false;
  const parser = (tx) =>
    new TransactionParser(ledgerProvider, tx, PARTY, true).parseTransaction();
  for (const tx of captured) {
    try {
      const parsed = await parser(tx);
      totalEvents += parsed.events.length;
      if (parsed.events.length > 0) parsedOk++;
      if (!samplePrinted && parsed.events.length > 0) {
        samplePrinted = true;
        const rendered = renderTransaction(parsed);
        console.log(
          `[C] SAMPLE rendered (updateId=${parsed.updateId?.slice(0, 16)}…):`,
          JSON.stringify(rendered).slice(0, 700),
        );
      }
    } catch (e) {
      parsedErr++;
      if (parsedErr <= 3)
        console.log(`[C] PARSE ERROR updateId=${tx.updateId?.slice(0, 16)}…: ${String(e).slice(0, 200)}`);
    }
  }
  console.log(
    `[VERDICT-2] parser: ${parsedOk} transaksi ter-parse dgn event, ${parsedErr} error, total parsed events=${totalEvents}`,
  );
  console.log(
    verdictLine(amuletViews, holdingViews, parsedOk, parsedErr),
  );
})().catch((e) => {
  console.error('SMOKE_ERROR', String(e));
  process.exit(1);
});

function verdictLine(amuletViews, holdingViews, parsedOk, parsedErr) {
  const viewsOk = amuletViews > 0 || holdingViews > 0;
  const parserOk = parsedOk > 0 && parsedErr === 0;
  if (viewsOk && parserOk) return '[VERDICT] HIJAU — interfaceViews hadir di WS & parser bekerja. L5 boleh jalan.';
  if (viewsOk && !parserOk) return '[VERDICT] MERAH — views ada tapi parser error. BERHENTI, laporkan.';
  return '[VERDICT] MERAH — interfaceViews TIDAK hadir di jalur WS LEDGER_EFFECTS. BERHENTI & laporkan (desain L5/L6 berubah).';
}
