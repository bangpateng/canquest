#!/usr/bin/env node
/**
 * L5 — ledger raw backfill worker (STANDALONE, terpisah dari proses API).
 *
 * MODE — dipilih eksplisit (keputusan Phase 4, konsekuensi temuan probe-b):
 *   DEFAULT: KONTINU. Mengejar dari cursor sampai head ledger, lalu TETAP
 *   MENYAMBUNG (streaming) sampai dihentikan (SIGINT/kill). Alasan: parser L6
 *   melayani callback create-archive dari raw layer, jadi setiap arsip yang
 *   L6 proses harus create-nya sudah tertangkap — berhenti di head pukul X
 *   meninggalkan arsip tanpa pasangan untuk transaksi setelah X.
 *   `--max-offset N`: pilot sekali-jalan — berhenti & exit setelah offset N
 *   ter-commit (untuk inspeksi 5.000 offset pertama).
 *
 * PRINSIP: L5 HANYA MENANGKAP. Tidak ada parser token-standard, tidak ada
 * klasifikasi, tidak ada atribusi user. LedgerEvent adalah ekstraksi MEKANIS
 * envelope (eventType/template/choice/cid/witnessParties) — tanpa semantik.
 *
 * Jaminan transaksional: satu batch (default 200 update) = SATU transaksi DB
 * (LedgerUpdate + LedgerEvent + cursor). Crash di mana pun → replay aman
 * (PK updateId/eventId + skipDuplicates). Idempoten di rentang mana pun.
 *
 * Jalankan DI VPS2:
 *   cd /var/www/canquest && node scripts/ledger-backfill.cjs [--max-offset N]
 *   env: LEDGER_BACKFILL_RATE (update/detik, default 50), STREAM_KEY_BACKFILL.
 */
const fs = require('fs');
const WebSocket = require('ws');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const STREAM_KEY = process.env.STREAM_KEY_BACKFILL || 'ledger-backfill';
const BATCH_SIZE = 200;
const RATE = Number(process.env.LEDGER_BACKFILL_RATE || 50); // update/detik
const START_OFFSET = 819747; // titik nol node (probe L1.5: transaksi pertama tersedia)
const TOKEN_LEAD_MS = 60_000;
const FLUSH_IDLE_MS = 2_000;

function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

function decodeJwtExpMs(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(
      Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Ekstraksi MEKANIS envelope → { updateRow, eventRows[] } — tanpa semantik. */
function extractRows(txValue) {
  const updateId = txValue.updateId;
  const offset = Number(txValue.offset);
  const recordTime = new Date(txValue.recordTime);
  const eventRows = [];
  const arr = txValue.events ?? [];
  arr.forEach((wrapper, idx) => {
    const keys = Object.keys(wrapper);
    const key = keys.find((k) => wrapper[k] && typeof wrapper[k] === 'object');
    if (!key) return;
    const inner = wrapper[key];
    const eventType =
      /created/i.test(key) ? 'created' : /archived/i.test(key) ? 'archived' : 'exercised';
    eventRows.push({
      updateId,
      eventIndex: idx,
      offset: BigInt(offset),
      recordTime,
      eventType,
      templateId: inner.templateId ?? null,
      choice: inner.choice ?? null,
      contractId: inner.contractId ?? null,
      witnessParties: inner.witnessParties ?? [],
      payload: inner,
    });
  });
  return {
    updateRow: {
      updateId,
      offset: BigInt(offset),
      recordTime,
      commandId: txValue.commandId ?? null,
      synchronizerId: txValue.synchronizerId ?? null,
      envelope: txValue,
    },
    eventRows,
  };
}

(async () => {
  const maxOffsetArg = process.argv.find((a) => a.startsWith('--max-offset'));
  const MAX_OFFSET = maxOffsetArg ? Number(maxOffsetArg.split('=')[1] ?? maxOffsetArg.split(' ')[1]) : null;
  console.log(
    `[L5] mode=${MAX_OFFSET ? `PILOT (berhenti di offset ${MAX_OFFSET})` : 'KONTINU (streaming sampai dihentikan)'} rate=${RATE}/dtk batch=${BATCH_SIZE}`,
  );

  const env = envFrom('/var/www/canquest/apps/api/.env');
  const base = (env.LEDGER_API_URL || '').replace(/\/$/, '');
  const wsUrl = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/v2/updates';

  const getToken = async () => {
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
    const tok = await r.json();
    if (!tok.access_token) throw new Error('token fetch gagal: ' + JSON.stringify(tok).slice(0, 200));
    return tok.access_token;
  };

  // Cursor awal: baris checkpoint stream ini, atau titik nol node.
  const cp = await prisma.ledgerStreamCheckpoint.findUnique({ where: { streamKey: STREAM_KEY } });
  let lastOffset = cp ? Number(cp.lastOffset) : START_OFFSET - 1;
  console.log(`[L5] cursor awal: ${lastOffset} (beginExclusive=${lastOffset})`);

  // Filter PERSIS yang terbukti di smoke L5.0 (views hadir di jalur ini).
  const IFACES = [
    '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
    '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory',
    '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationInstruction',
    '#splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
    '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation',
  ];
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

  let stopping = false;
  let stats = { updates: 0, events: 0, batches: 0, firstOffset: null, lastTxOffset: null };
  let buffer = { updates: [], events: [], maxOffset: null };
  let flushTimer = null;
  let ws = null;
  let proactiveTimer = null;
  let currentToken = null;

  process.on('SIGINT', () => {
    console.log('[L5] SIGINT — selesaikan batch berjalan lalu exit.');
    stopping = true;
    try { ws && ws.close(1000); } catch {}
  });

  /**
   * Flush TERSERIALISASI + SNAPSHOT SINKRON. Pelajaran pilot #2: flush lama
   * fire-and-forget — dua transaksi berlari memakai `buffer` yang sama,
   * snapshot dibaca SETELAH await (race), pool habis → "Unable to start a
   * transaction", dan cursor bisa MUNDUR antar batch (849849 → 845853 di
   * log). Perbaikan: buffer diambil-alih secara sinkron di sini; transaksi
   * memakai snapshot; antrean promise menjamin satu transaksi pada satu
   * waktu; cursor hanya maju bersama batch yang berhasil commit (error =
   * exit 1, replay aman karena idempoten).
   */
  let flushChain = Promise.resolve();
  function requestFlush(reason) {
    if (buffer.updates.length === 0) return;
    const batch = buffer;
    buffer = { updates: [], events: [], maxOffset: null };
    flushChain = flushChain
      .then(async () => {
        const t0 = Date.now();
        await prisma.$transaction(
          async (tx) => {
            await tx.ledgerUpdate.createMany({ data: batch.updates, skipDuplicates: true });
            if (batch.events.length)
              await tx.ledgerEvent.createMany({ data: batch.events, skipDuplicates: true });
            await tx.ledgerStreamCheckpoint.upsert({
              where: { streamKey: STREAM_KEY },
              create: { streamKey: STREAM_KEY, lastOffset: BigInt(Number(batch.maxOffset)) },
              update: { lastOffset: BigInt(Number(batch.maxOffset)) },
            });
          },
          { timeout: 30_000, maxWait: 15_000 },
        );
        stats.updates += batch.updates.length;
        stats.events += batch.events.length;
        stats.batches++;
        stats.lastTxOffset = Number(batch.maxOffset);
        if (stats.firstOffset === null && batch.updates[0])
          stats.firstOffset = Number(batch.updates[0].offset);
        // Throttle: pastikan kecepatan <= RATE.
        const minMs = (batch.updates.length / RATE) * 1000;
        const elapsed = Date.now() - t0;
        if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
        if (stats.batches % 10 === 0 || reason !== 'full')
          console.log(
            `[L5] batch#${stats.batches} (${reason}) +${batch.updates.length} upd → total ${stats.updates} upd / ${stats.events} evt, cursor=${Number(batch.maxOffset)}`,
          );
      })
      .catch((e) => {
        console.error('[L5] flush error — exit tanpa memajukan cursor (replay aman):', String(e).slice(0, 300));
        process.exit(1);
      });
  }

  function scheduleIdleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      requestFlush('idle');
      scheduleIdleFlush();
    }, FLUSH_IDLE_MS);
  }

  async function connect() {
    currentToken = await getToken();
    const expMs = decodeJwtExpMs(currentToken);
    ws = new WebSocket(wsUrl, ['daml.ws.auth'], {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    ws.on('open', () => {
      console.log(`[L5] WS open — subscribe beginExclusive=${lastOffset}`);
      ws.send(
        JSON.stringify({
          beginExclusive: lastOffset,
          updateFormat: {
            includeTransactions: {
              eventFormat: { filtersForAnyParty: { cumulative }, verbose: true },
              transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
            },
          },
        }),
      );
      // Proactive reconnect sebelum token mati (stream validate per-RPC).
      if (proactiveTimer) clearTimeout(proactiveTimer);
      const delay = expMs ? Math.max(expMs - Date.now() - TOKEN_LEAD_MS, 30_000) : 240_000;
      proactiveTimer = setTimeout(() => {
        console.log('[L5] proactive reconnect (token nearing expiry)');
        try { ws.close(1000); } catch {}
        if (!stopping) void reconnectLoop();
      }, delay);
    });
    ws.on('message', (d) => {
      if (stopping) return; // pasca-batas pilot / SIGINT: jangan buffer lagi
      let j = null;
      try { j = JSON.parse(d.toString()); } catch { return; }
      const tx = j?.update?.Transaction?.value ?? (j?.updateId ? j : null);
      if (!tx || !tx.updateId) return; // OffsetCheckpoint / lainnya diabaikan
      const off = Number(tx.offset);
      if (!Number.isFinite(off)) return;
      const { updateRow, eventRows } = extractRows(tx);
      buffer.updates.push(updateRow);
      buffer.events.push(...eventRows);
      buffer.maxOffset = off;
      lastOffset = off;
      if (buffer.updates.length >= BATCH_SIZE) requestFlush('full');
      if (MAX_OFFSET !== null && off >= MAX_OFFSET) {
        // Berhenti SEGERA: tutup WS supaya tidak ada pesan lanjutan yang
        // di-buffer; buffer saat ini di-flush satu kali di jalur keluar.
        console.log(`[L5] PILOT: offset ${off} >= ${MAX_OFFSET} — stop buffering, commit & exit.`);
        stopping = true;
        try { ws.close(1000); } catch {}
      }
    });
    ws.on('close', () => {
      if (proactiveTimer) clearTimeout(proactiveTimer);
      if (!stopping) {
        console.log('[L5] WS closed (unexpected) — retry 5s');
        setTimeout(() => void reconnectLoop(), 5_000);
      }
    });
    ws.on('error', (e) => {
      console.error('[L5] WS error:', String(e).slice(0, 200));
    });
  }

  let connecting = false;
  async function reconnectLoop() {
    if (connecting || stopping) return;
    connecting = true;
    try {
      try { ws && ws.removeAllListeners() && ws.close(); } catch {}
      await connect();
    } catch (e) {
      console.error('[L5] connect gagal:', String(e).slice(0, 200), '— retry 10s');
      setTimeout(() => void reconnectLoop(), 10_000);
    } finally {
      connecting = false;
    }
  }

  await reconnectLoop();
  scheduleIdleFlush();

  // Selesai (pilot) atau loop kontinu sampai SIGINT.
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (stopping) {
        clearInterval(check);
        resolve();
      }
    }, 250);
  });
  if (flushTimer) clearTimeout(flushTimer);
  requestFlush('final');
  await flushChain; // tunggu seluruh antrean batch termasuk yang terakhir
  console.log(
    `[L5] SELESAI — mode=${MAX_OFFSET ? 'PILOT' : 'KONTINU-dihentikan'}: ${stats.updates} update, ${stats.events} event, ${stats.batches} batch, offset ${stats.firstOffset}..${stats.lastTxOffset}, cursor=${lastOffset}`,
  );
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('[L5] FATAL', String(e));
  process.exit(1);
});
