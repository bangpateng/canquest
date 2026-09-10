#!/usr/bin/env node
/**
 * Simulasi pola transaksi dgn ATURAN BARU (escrow-matched hint):
 * kandidat dari payload LedgerEvent DB dicocokkan daftar escrow aktif user.
 * READ-ONLY (SELECT saja).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const USER = 'cmt44cizn000tkh333wq42dwp';

async function escrows() {
  const since = new Date(Date.now() - 6 * 60 * 60_000); // jendela lebar utk sim
  const [cc, tok] = await Promise.all([
    prisma.ccTransaction.findMany({ where: { userId: USER, type: 'SWAP_OUT', createdAt: { gte: since } }, select: { referenceId: true } }),
    prisma.tokenTransaction.findMany({ where: { userId: USER, type: 'SWAP_OUT', createdAt: { gte: since } }, select: { referenceId: true } }),
  ]);
  return new Set([...cc, ...tok].map((r) => (r.referenceId || '').trim()).filter((r) => r.includes('::')));
}

async function sim(updateId, escSet) {
  const rows = await prisma.ledgerEvent.findMany({ where: { updateId }, orderBy: { eventIndex: 'asc' } });
  const receivers = new Set(), cands = [];
  for (const r of rows) {
    const p = r.payload || {};
    if (r.eventType === 'created') {
      const a = p.createArgument || {};
      if (typeof a.owner === 'string') receivers.add(a.owner);
      else if (typeof a.receiver === 'string') receivers.add(a.receiver);
    } else if (r.eventType === 'exercised') {
      for (const x of [...(p.actingParties || []), ...(p.witnessParties || [])]) {
        if (!x || receivers.has(x)) continue;
        const l = x.toLowerCase();
        if (x.startsWith('canquest:') || l.startsWith('dso') || l.startsWith('cantex') || l.startsWith('bridge-operator') || l.startsWith('validator-app') || l.startsWith('canquest-validator')) continue;
        if (!cands.includes(x)) cands.push(x);
      }
    }
  }
  let hint = null;
  if (cands.length && escSet.size) { for (const c of cands) if (escSet.has(c)) { hint = c; break; } }
  else if (cands.length === 1) hint = cands[0];
  const hasAccept = rows.some((r) => r.eventType === 'exercised' && (r.payload || {}).choice === 'TransferInstruction_Accept');
  const offer = rows.some((r) => r.eventType === 'created' && ((r.templateId || '').includes(':TransferOffer') || (r.templateId || '').includes(':TransferInstruction')));
  console.log(JSON.stringify({
    update: updateId.slice(0, 16),
    kandidat: cands.map((c) => c.split('::')[0]),
    hint: hint ? hint.split('::')[0] : null,
    SIMULASI: offer && !hasAccept ? 'TANPA BARIS (offer)' : `1 BARIS (sender=${hint ? hint.split('::')[0] : 'null'})`,
  }));
}

async function main() {
  const esc = await escrows();
  console.log('escrow aktif:', [...esc].map((e) => e.split('::')[0]));
  for (const id of process.argv.slice(2)) await sim(id, esc);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
