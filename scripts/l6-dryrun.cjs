#!/usr/bin/env node
/**
 * L6.1 + L6.2 DRY-RUN — klasifikasi penuh ATAS RAW LAYER, TANPA MENULIS
 * apa pun (nol baris Activity). Laporan: distribusi klasifikasi, suppress
 * net-zero, fallback HTTP, rekonsiliasi Σnet(≤X) vs ACS@X per party per
 * instrumen, determinisme dua-pass.
 *
 * Parser resmi core-tx-parser dengan provider raw-layer-first:
 * callback /v2/events/events-by-contract-id dijawab dari LedgerEvent bila
 * create-nya MEMILIKI interfaceViews (buildRawEvent membutuhkannya);
 * selebihnya fallback HTTP ke ledger (dihitung).
 *
 * Jalankan DI VPS2: cd /var/www/canquest && node scripts/l6-dryrun.cjs
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const {
  TransactionParser,
} = require('@canton-network/core-tx-parser');

const prisma = new PrismaClient();
const DSO_HINT = 'dso';

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

  // ── Metrik provider ────────────────────────────────────────────────────
  let rawHits = 0;
  let httpFallbacks = 0;
  const provider = {
    async request({ params }) {
      const { resource, requestMethod, body } = params;
      if (resource === '/v2/events/events-by-contract-id') {
        const cid = body?.contractId;
        const row = cid
          ? await prisma.ledgerEvent.findFirst({
              where: {
                eventType: 'created',
                contractId: cid,
                OR: [
                  { templateId: { contains: 'Amulet' } },
                  { templateId: { contains: 'Holding:Holding' } },
                ],
              },
              orderBy: { offset: 'asc' },
              select: { payload: true },
            })
          : null;
        const ce = row?.payload;
        if (
          ce &&
          Array.isArray(ce.interfaceViews) &&
          ce.interfaceViews.length > 0
        ) {
          rawHits++;
          return { created: { createdEvent: ce }, archived: { contractId: cid } };
        }
        httpFallbacks++;
      }
      const res = await fetch(base + resource, {
        method: (requestMethod || 'post').toUpperCase(),
        headers: auth,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 404) return null; // CONTRACT_EVENTS_NOT_FOUND → parser skip
        throw new Error(`ledgerApi ${resource} ${res.status}: ${text.slice(0, 160)}`);
      }
      return JSON.parse(text);
    },
  };

  // ── Party aktif dari DB (resolver ketat: cantonPartyId eksak) ─────────
  const users = await prisma.user.findMany({
    where: { cantonPartyId: { not: null } },
    select: { username: true, cantonPartyId: true },
  });
  const activeParties = users
    .filter((u) => u.cantonPartyId && !u.cantonPartyId.startsWith('canquest:'))
    .map((u) => ({ username: u.username, party: u.cantonPartyId }));
  const activeSet = new Set(activeParties.map((p) => p.party.toLowerCase()));
  console.log(`party aktif: ${activeParties.length}`);

  // ── Muat raw updates ───────────────────────────────────────────────────
  const updates = await prisma.ledgerUpdate.findMany({
    orderBy: { offset: 'asc' },
    select: { offset: true, recordTime: true, envelope: true },
  });
  const X = Number(updates[updates.length - 1].offset);
  console.log(`raw updates: ${updates.length}, offset maks (X) = ${X}`);

  const instrKey = (inst) => `${inst.admin}|${inst.id}`;
  const isDso = (p) => typeof p === 'string' && p.toLowerCase().startsWith(DSO_HINT);
  /** Normalizer party: sebagian varian TI memakai {party: "..."} bukan string. */
  const asParty = (v) =>
    typeof v === 'string' ? v :
    v && typeof v === 'object' && typeof v.party === 'string' ? v.party :
    null;

  /** Satu pass klasifikasi → hasil + metrik (deterministik). */
  async function classifyPass() {
    const m = {
      updatesProcessed: 0,
      updatesSkippedNoParty: 0,
      parseErrors: 0,
      parseErrorSamples: [],
      rows: new Map(), // `${party}|${updateId}|${inst}` → row
      reconciliation: new Map(), // `${party}|${inst}` → number (unlocked+locked)
      suppressedNetZero: 0,
      lockFlows: 0,
      dirCount: { in: 0, out: 0 },
      rewardCount: 0,
      failedRows: [],
      pendingRows: 0,
      completedTwoStep: 0,
      instructionFinalChoices: {}, // cid → choice consuming terakhir
    };
    for (const u of updates) {
      const tx = u.envelope;
      // Party kandidat dari witness/acting parties di event envelope.
      const candidates = new Set();
      for (const w of tx.events ?? []) {
        const inner = Object.values(w)[0];
        if (!inner) continue;
        for (const p of [
          ...(inner.witnessParties ?? []),
          ...(inner.actingParties ?? []),
          ...(inner.signatories ?? []),
        ]) {
          const low = String(p).toLowerCase();
          if (activeSet.has(low)) candidates.add(low);
        }
      }
      // Pilihan konsumsi instruksi transfer (utk status dua-langkah).
      for (const w of tx.events ?? []) {
        const inner = Object.values(w)[0];
        if (
          inner &&
          inner.choice &&
          String(inner.templateId || '').includes('TransferInstruction') &&
          inner.consuming
        ) {
          m.instructionFinalChoices[inner.contractId] = inner.choice;
        }
      }
      if (candidates.size === 0) {
        m.updatesSkippedNoParty++;
        continue;
      }
      m.updatesProcessed++;
      for (const cand of candidates) {
        const partyInfo = activeParties.find(
          (p) => p.party.toLowerCase() === cand,
        );
        let parsed;
        try {
          parsed = await new TransactionParser(provider, tx, partyInfo.party, false).parseTransaction();
        } catch (e) {
          m.parseErrors++;
          if (m.parseErrorSamples.length < 3)
            m.parseErrorSamples.push(`${u.envelope.updateId?.slice(0, 14)}… ${String(e).slice(0, 120)}`);
          continue;
        }
        if (!parsed.events || parsed.events.length === 0) continue;

        // Akumulasi net per instrumen (rekonsiliasi: unlocked + locked).
        const netAll = new Map(); // instKey → number (rekonsiliasi)
        const netUnlocked = new Map(); // instKey → number (display)
        let counterparty = null;
        let instrCid = null;
        let executeBefore = null;
        for (const ev of parsed.events) {
          const summaries = [
            ...(ev.unlockedHoldingsChangeSummaries ?? []),
            ...(ev.lockedHoldingsChangeSummaries ?? []),
          ];
          for (const s of summaries) {
            const k = instrKey(s.instrumentId);
            netAll.set(k, (netAll.get(k) ?? 0) + Number(s.amountChange));
            if (s.amountChange !== undefined) {
              // unlocked-only utk display: cek keanggotaan via unlocked summaries
            }
          }
          for (const s of ev.unlockedHoldingsChangeSummaries ?? []) {
            const k = instrKey(s.instrumentId);
            netUnlocked.set(k, (netUnlocked.get(k) ?? 0) + Number(s.amountChange));
          }
          const ti = ev.transferInstruction;
          if (ti?.transfer) {
            const sender = asParty(ti.transfer.sender);
            const receiver = asParty(ti.transfer.receiver);
            counterparty =
              sender && sender.toLowerCase() === cand ? receiver : sender;
            instrCid = ti.originalInstructionCid ?? instrCid;
            executeBefore = ti.transfer.executeBefore ?? executeBefore;
          }
        }

        for (const [k, v] of netAll) {
          const rk = `${partyInfo.party}|${k}`;
          m.reconciliation.set(rk, (m.reconciliation.get(rk) ?? 0) + v);
        }

        // Klasifikasi baris per instrumen.
        const netUnlockedArr = [...netUnlocked.entries()].filter(([, v]) => v !== 0);
        const hasLockedOnly =
          netUnlockedArr.length === 0 &&
          [...netAll.values()].some((v) => v !== 0);
        if (netUnlockedArr.length === 0 && !hasLockedOnly) {
          m.suppressedNetZero++;
          continue;
        }
        if (hasLockedOnly) {
          m.lockFlows++;
          continue; // lock/unlock: bukan aktivitas ledger-derived v1 (app-activity lama)
        }
        for (const [k, v] of netUnlockedArr) {
          const [admin, id] = k.split('|');
          const direction = v > 0 ? 'in' : 'out';
          // Reward = net positif yang counterparty-nya DSO (mint reward).
          const isReward = v > 0 && isDso(counterparty);
          if (isReward) m.rewardCount++;
          else m.dirCount[direction]++;
          // Status: dua-langkah bila ada instruction cid.
          let status = 'completed';
          if (instrCid) {
            const fin = m.instructionFinalChoices[instrCid];
            if (fin === undefined) {
              status = 'pending';
              m.pendingRows++;
            } else if (fin === 'TransferInstruction_Accept' || fin.includes('Accept')) {
              status = 'completed';
              m.completedTwoStep++;
            } else if (fin.includes('Reject')) {
              status = 'rejected';
            } else if (fin.includes('Withdraw')) {
              status = 'withdrawn';
            } else {
              status = 'failed';
              m.failedRows.push({ choice: fin, updateId: u.envelope.updateId });
            }
          }
          m.rows.set(`${partyInfo.party}|${u.envelope.updateId}|${k}`, {
            party: partyInfo.party,
            username: partyInfo.username,
            updateId: u.envelope.updateId,
            offset: Number(u.offset),
            instrument: k,
            direction,
            kind: isReward ? 'reward' : 'transfer',
            amount: Math.abs(v),
            counterparty,
            status,
            executeBefore,
          });
        }
      }
    }
    return m;
  }

  const t0 = Date.now();
  console.log('— pass 1 —');
  const pass1 = await classifyPass();
  const t1 = Date.now();
  console.log(`pass 1 selesai ${(t1 - t0) / 1000}s`);
  console.log('— pass 2 (determinisme) —');
  const pass2 = await classifyPass();
  const t2 = Date.now();
  console.log(`pass 2 selesai ${((t2 - t1) / 1000).toFixed(0)}s`);

  const sig = (m) =>
    JSON.stringify([...m.rows.entries()].map(([k, v]) => [k, v]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const deterministic = sig(pass1) === sig(pass2);

  // ── Rekonsiliasi: ACS pada activeAtOffset = X ──────────────────────────
  const acsFor = async (party) => {
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
        activeAtOffset: X,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const rows = res.ok ? await res.json() : [];
    const sums = {}; // instKey → amount
    for (const entry of Array.isArray(rows) ? rows : []) {
      const ev =
        entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry ?? {};
      const tpl = String(ev.templateId || '');
      const args = ev.createArgument ?? {};
      const owner = typeof args.owner === 'string' ? args.owner : null;
      if (owner && owner !== party) continue;
      let instId = null;
      let instAdmin = null;
      let amt = null;
      if (tpl.includes('Splice.Amulet:Amulet') || tpl.includes('Splice.Amulet:LockedAmulet')) {
        instId = 'Amulet';
        instAdmin = 'DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc';
        amt = parseFloat(args.amount?.initialAmount ?? args.amount?.amount ?? args.amount ?? '0');
      } else if (tpl.endsWith('Holding:Holding')) {
        instId = args.instrument?.id ?? args.instrumentId?.id ?? null;
        instAdmin = args.instrument?.admin ?? args.instrument?.source ?? args.instrumentId?.admin ?? null;
        amt = parseFloat(args.amount?.initialAmount ?? args.amount?.amount ?? args.amount ?? '0');
      }
      if (!instId || !instAdmin || !Number.isFinite(amt)) continue;
      const k = `${instAdmin}|${instId}`;
      sums[k] = (sums[k] ?? 0) + amt;
    }
    return sums;
  };

  console.log('\n════════ LAPORAN DRY-RUN ════════');
  console.log(`1. updates: diproses ${pass1.updatesProcessed}, skipped-no-party ${pass1.updatesSkippedNoParty}`);
  console.log(`   suppressed net-zero: ${pass1.suppressedNetZero} | lock-flows (non-display): ${pass1.lockFlows}`);
  console.log(`2. klasifikasi: in=${pass1.dirCount.in} out=${pass1.dirCount.out} reward=${pass1.rewardCount} pending=${pass1.pendingRows} rejected/withdrawn=${[...pass1.rows.values()].filter((r) => r.status === 'rejected' || r.status === 'withdrawn').length} failed=${pass1.failedRows.length}`);
  if (pass1.failedRows.length)
    console.log(`   FAILED choices: ${JSON.stringify(pass1.failedRows.slice(0, 10))}`);
  console.log(`   parse errors: ${pass1.parseErrors} ${JSON.stringify(pass1.parseErrorSamples)}`);
  console.log(`3. callback: raw-hit=${rawHits / 2}, http-fallback=${httpFallbacks / 2} (dibagi 2 utk 2 pass)`);

  // 5. baris per party + perbandingan kasar.
  const byParty = {};
  for (const r of pass1.rows.values()) byParty[r.username] = (byParty[r.username] ?? 0) + 1;
  console.log('5. baris per party (vs lama: 243 CC + 15 token total):');
  for (const [u, c] of Object.entries(byParty)) console.log(`   ${u.padEnd(14)} ${c}`);
  console.log(`   TOTAL baru: ${pass1.rows.size}`);

  console.log('4. rekonsiliasi Σnet(≤X) vs ACS@X:');
  let allMatch = true;
  for (const ap of activeParties) {
    const acs = await acsFor(ap.party);
    const keys = new Set([...Object.keys(acs)]);
    for (const [rk] of pass1.reconciliation)
      if (rk.startsWith(`${ap.party}|`)) keys.add(rk.slice(ap.party.length + 1));
    for (const k of keys) {
      const net = pass1.reconciliation.get(`${ap.party}|${k}`) ?? 0;
      const onchain = acs[k] ?? 0;
      const diff = Math.abs(net - onchain);
      const ok = diff < 1e-6;
      if (!ok) allMatch = false;
      console.log(
        `   ${ap.username.padEnd(14)} ${k.includes('Amulet') ? 'CC ' : k.split('|')[1].padEnd(6)} net=${net.toFixed(6).padStart(14)} ACS@X=${onchain.toFixed(6).padStart(14)} ${ok ? 'COCOK' : 'SELISIH ' + diff.toFixed(6)}`,
      );
    }
  }
  console.log(`   → ${allMatch ? 'SEMUA COCOK' : 'ADA SELISIH — BERHENTI, JANGAN DISETEL'}`);
  console.log(`6. determinisme 2 pass: ${deterministic ? 'IDENTIK' : 'BEDA — BUG'}`);
  console.log(`total waktu: ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error('DRYRUN_ERROR', String(e));
  process.exit(1);
});
