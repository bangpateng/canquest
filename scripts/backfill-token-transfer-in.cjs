#!/usr/bin/env node
/**
 * Backfill TOKEN_TRANSFER_IN penerima untuk offer USDCx yang sudah di-accept
 * tapi row-nya tidak pernah dibuat (bug sender-row tanpa transferInstructionCid,
 * 2026-09-04). Sekaligus rekonsiliasi CantexTokenBalance ke kebenaran on-chain
 * (jumlah Holding USDCx aktif via ACS eventFormat + activeAtOffset).
 *
 * Jalankan DI VPS2:  node scripts/backfill-token-transfer-in.cjs [--dry]
 */
const fs = require('fs');
const { PrismaClient } = require('/var/www/canquest/node_modules/@prisma/client');

const DRY = process.argv.includes('--dry');

function envFrom(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

async function adminHeaders(env) {
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
  return {
    Authorization: `Bearer ${tok.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Jumlah token on-chain sebuah party (semua Holding non-Amulet), by instrument. */
async function onChainTokenHoldings(env, auth, partyId) {
  const base = env.LEDGER_API_URL?.replace(/\/$/, '') || 'https://ledger.canquestlabs.com';
  const end = await (await fetch(`${base}/v2/state/ledger-end`, { headers: auth })).json();
  const res = await fetch(`${base}/v2/state/active-contracts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            ],
          },
        },
      },
      activeAtOffset: Number(end.offset),
    }),
  });
  if (!res.ok) throw new Error(`ACS ${res.status}`);
  const rows = await res.json();
  if (process.env.DEBUG_BF) {
    const hist = {};
    for (const e of Array.isArray(rows) ? rows : []) {
      const ev = e?.contractEntry?.JsActiveContract?.createdEvent ?? e;
      hist[ev.templateId] = (hist[ev.templateId] || 0) + 1;
    }
    console.log(
      `[debug] ACS status=${res.status} rows=${Array.isArray(rows) ? rows.length : '?'} hist=${JSON.stringify(hist)}`,
    );
  }
  const out = new Map(); // instrumentId|admin → { amount, admin }
  for (const entry of Array.isArray(rows) ? rows : []) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    const tpl = String(ev.templateId || '');
    if (!tpl.endsWith('Holding:Holding')) continue;
    const args = ev.createArgument || {};
    // mirror balance-event-handler.extractTokenInstrument/Amount
    let instId = '', instAdmin = '';
    const inst = args.instrument || {};
    if (inst.id) instId = inst.id;
    if (inst.admin) instAdmin = inst.admin;
    if (!instAdmin && inst.source) instAdmin = inst.source;
    if (!instId && typeof args.instrumentId === 'string') instId = args.instrumentId;
    if (!instId && typeof args.label === 'string') instId = args.label;
    if (!instAdmin && typeof args.registrar === 'string') instAdmin = args.registrar;
    if (!instId || instId.toLowerCase() === 'amulet') continue;
    let amtStr = null;
    if (typeof args.amount === 'string') amtStr = args.amount;
    else if (args.amount?.initialAmount) amtStr = args.amount.initialAmount;
    else if (args.amount?.amount) amtStr = args.amount.amount;
    else if (typeof args.balance === 'string') amtStr = args.balance;
    const amt = parseFloat(amtStr);
    if (!Number.isFinite(amt)) continue;
    const key = `${instId}|${instAdmin}`;
    const prev = out.get(key) || { amount: 0, instrumentId: instId, instrumentAdmin: instAdmin };
    prev.amount += amt;
    out.set(key, prev);
  }
  return [...out.values()];
}

(async () => {
  const env = envFrom('/var/www/canquest/apps/api/.env');
  const prisma = new PrismaClient();
  const auth = await adminHeaders(env);

  // 1. Semua TOKEN_TRANSFER_OUT yang TIDAK punya kembaran TOKEN_TRANSFER_IN
  //    (match: receiver sama via referenceId, cantonUpdateId sama).
  const outs = await prisma.tokenTransaction.findMany({
    where: { type: 'TOKEN_TRANSFER_OUT' },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`TOKEN_TRANSFER_OUT rows: ${outs.length}`);

  for (const out of outs) {
    const receiverParty = out.referenceId;
    if (!receiverParty) continue;
    const receiver = await prisma.user.findFirst({
      where: { cantonPartyId: receiverParty },
      select: { id: true, username: true },
    });
    if (!receiver) {
      console.log(`SKIP (receiver bukan user dapp): ${receiverParty.split('::')[0]}`);
      continue;
    }
    // Sudah ada row TRANSFER_IN utk updateId ini?
    const existing = await prisma.tokenTransaction.findFirst({
      where: {
        userId: receiver.id,
        cantonUpdateId: out.cantonUpdateId,
        type: 'TOKEN_TRANSFER_IN',
      },
    });
    if (existing) {
      console.log(`OK sudah ada: ${out.cantonUpdateId?.slice(0, 16)} → @${receiver.username}`);
      continue;
    }
    // Offer masih pending (belum di-accept)? Cek status row sender.
    if (out.status === 'PENDING') {
      console.log(`SKIP (masih PENDING): ${out.cantonUpdateId?.slice(0, 16)} → @${receiver.username}`);
      continue;
    }
    // Row COMPLETED tanpa cid = offer era bug. Verifikasi on-chain: penerima
    // punya holding instrument ini SEKARANG (bukti diterima, bukan withdrawn).
    const holdings = await onChainTokenHoldings(env, auth, receiverParty);
    if (process.env.DEBUG_BF) {
      console.log(
        `[debug] holdings @${receiver.username} party=${receiverParty.split('::')[0]}:`,
        JSON.stringify(holdings),
      );
    }
    const match = holdings.find(
      (h) => h.instrumentId.toLowerCase() === out.instrumentId.toLowerCase(),
    );
    if (!match || match.amount <= 0) {
      console.log(
        `SKIP (on-chain ${out.instrumentId} utk @${receiver.username} = ${match?.amount ?? 0} — kemungkinan withdrawn/rejected): ${out.cantonUpdateId?.slice(0, 16)}`,
      );
      continue;
    }
    const sender = await prisma.user.findUnique({
      where: { id: out.userId },
      select: { cantonPartyId: true, username: true },
    });
    const amount = Math.abs(Number(out.amount));
    console.log(
      `INSERT TOKEN_TRANSFER_IN: @${receiver.username} +${amount} ${out.instrumentId} from @${sender?.username ?? '?'} (tx ${out.cantonUpdateId?.slice(0, 16)}…)`,
    );
    if (!DRY) {
      await prisma.tokenTransaction.create({
        data: {
          userId: receiver.id,
          instrumentId: out.instrumentId,
          instrumentAdmin: out.instrumentAdmin,
          amount,
          type: 'TOKEN_TRANSFER_IN',
          description: `Received ${amount} ${out.instrumentId}${sender?.username ? ` from @${sender.username}` : ''}`,
          referenceId: sender?.cantonPartyId ?? null,
          ledgerTxId: `backfill-${out.id}`,
          cantonUpdateId: out.cantonUpdateId,
          status: 'COMPLETED',
        },
      });
    }
  }

  // 2. Rekonsiliasi CantexTokenBalance penerima ke on-chain (untuk party yang
  //    terlibat di atas saja — bukan sweep global).
  const parties = [...new Set(outs.map((o) => o.referenceId).filter(Boolean))];
  for (const partyId of parties) {
    const user = await prisma.user.findFirst({
      where: { cantonPartyId: partyId },
      select: { id: true, username: true },
    });
    if (!user) continue;
    const holdings = await onChainTokenHoldings(env, auth, partyId);
    for (const h of holdings) {
      const row = await prisma.cantexTokenBalance.findFirst({
        where: {
          userId: user.id,
          instrumentId: { equals: h.instrumentId, mode: 'insensitive' },
          instrumentAdmin: { equals: h.instrumentAdmin, mode: 'insensitive' },
        },
      });
      const current = row ? Number(row.balance) : 0;
      if (Math.abs(current - h.amount) > 1e-9) {
        console.log(
          `BALANCE @${user.username} ${h.instrumentId}: DB=${current} → ON-CHAIN=${h.amount}`,
        );
        if (!DRY) {
          if (row) {
            await prisma.cantexTokenBalance.update({
              where: { id: row.id },
              data: { balance: h.amount },
            });
          } else {
            await prisma.cantexTokenBalance.create({
              data: {
                userId: user.id,
                instrumentId: h.instrumentId,
                instrumentAdmin: h.instrumentAdmin,
                balance: h.amount,
              },
            });
          }
        }
      }
    }
  }

  console.log(DRY ? '[DRY RUN — tidak ada perubahan]' : 'SELESAI.');
  await prisma.$disconnect();
})().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
